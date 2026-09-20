"""SQLite persistence for consultations, drafts and the audit trail.

Stdlib sqlite3 — no ORM. Every query is scoped by the Clerk user id so one
clinician can never read or edit another's records; callers pass the user_id
from the verified JWT, never from the request body.

ponytail: SQLite at DB_PATH. On Lambda the default /tmp path is per-container
and is lost on a cold start — point DB_PATH at an EFS mount for durable
storage, or swap these six functions for DynamoDB/RDS if you need concurrent
writers across instances.
"""

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = os.getenv("DB_PATH", "/tmp/medinotes.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS consultations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    patient_name    TEXT NOT NULL,
    patient_email   TEXT,
    date_of_visit   TEXT NOT NULL,
    notes           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft',
    emailed_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consultations_user
    ON consultations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    consultation_id INTEGER,
    action          TEXT NOT NULL,
    detail          TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_consultation
    ON audit_log(consultation_id, id DESC);
"""

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def valid_email(address: str) -> bool:
    return bool(address and EMAIL_RE.match(address.strip()))


@contextmanager
def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        # WAL keeps a reader from blocking the writer during a long stream.
        conn.execute("PRAGMA journal_mode=WAL")


def log(conn, user_id: str, action: str, consultation_id=None, detail=None) -> None:
    conn.execute(
        "INSERT INTO audit_log (user_id, consultation_id, action, detail, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (user_id, consultation_id, action, detail, now()),
    )


def create_consultation(user_id: str, patient_name: str, date_of_visit: str,
                        notes: str, patient_email: str = None) -> int:
    """Insert before the model runs, so a disconnected stream still leaves a record."""
    stamp = now()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO consultations"
            " (user_id, patient_name, patient_email, date_of_visit, notes,"
            "  summary, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, '', 'generating', ?, ?)",
            (user_id, patient_name, patient_email, date_of_visit, notes, stamp, stamp),
        )
        consultation_id = cur.lastrowid
        log(conn, user_id, "generate", consultation_id, patient_name)
        return consultation_id


def save_summary(user_id: str, consultation_id: int, summary: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE consultations SET summary = ?, status = 'draft', updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (summary, now(), consultation_id, user_id),
        )


def list_consultations(user_id: str, query: str = "", limit: int = 100) -> list[dict]:
    sql = (
        "SELECT id, patient_name, patient_email, date_of_visit, status, emailed_at,"
        "       created_at, substr(notes, 1, 160) AS notes_preview"
        " FROM consultations WHERE user_id = ?"
    )
    params: list = [user_id]
    if query:
        sql += " AND patient_name LIKE ?"
        params.append(f"%{query}%")
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params)]


def get_consultation(user_id: str, consultation_id: int) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM consultations WHERE id = ? AND user_id = ?",
            (consultation_id, user_id),
        ).fetchone()
        if row is None:
            return None
        record = dict(row)
        record["audit"] = [
            dict(entry)
            for entry in conn.execute(
                "SELECT action, detail, created_at FROM audit_log"
                " WHERE consultation_id = ? AND user_id = ? ORDER BY id DESC LIMIT 50",
                (consultation_id, user_id),
            )
        ]
        return record


def update_consultation(user_id: str, consultation_id: int,
                        summary: str = None, patient_email: str = None) -> bool:
    """Save clinician edits to the draft. Returns False if the row isn't theirs."""
    fields, params = [], []
    if summary is not None:
        fields.append("summary = ?")
        params.append(summary)
    if patient_email is not None:
        fields.append("patient_email = ?")
        params.append(patient_email)
    if not fields:
        return True

    fields.append("updated_at = ?")
    params.extend([now(), consultation_id, user_id])
    with connect() as conn:
        cur = conn.execute(
            f"UPDATE consultations SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            params,
        )
        if cur.rowcount == 0:
            return False
        log(conn, user_id, "edit", consultation_id,
            "summary edited" if summary is not None else "patient email set")
        return True


def mark_emailed(user_id: str, consultation_id: int, recipient: str) -> None:
    stamp = now()
    with connect() as conn:
        conn.execute(
            "UPDATE consultations SET status = 'emailed', emailed_at = ?,"
            " patient_email = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (stamp, recipient, stamp, consultation_id, user_id),
        )
        log(conn, user_id, "email_sent", consultation_id, recipient)


def delete_consultation(user_id: str, consultation_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM consultations WHERE id = ? AND user_id = ?",
            (consultation_id, user_id),
        )
        if cur.rowcount:
            log(conn, user_id, "delete", consultation_id, None)
        return cur.rowcount > 0


def stats(user_id: str) -> dict:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total,"
            "       SUM(CASE WHEN status = 'emailed' THEN 1 ELSE 0 END) AS emailed,"
            "       SUM(CASE WHEN created_at >= date('now', '-7 days') THEN 1 ELSE 0 END)"
            "           AS last_7_days"
            " FROM consultations WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return {
            "total": row["total"] or 0,
            "emailed": row["emailed"] or 0,
            "last_7_days": row["last_7_days"] or 0,
        }
