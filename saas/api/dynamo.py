"""DynamoDB persistence — the durable backend used on Lambda.

Same function signatures as db.py, so server.py can pick either at import:
set DYNAMODB_TABLE and this module is used, leave it unset and SQLite is.

Why not EFS + SQLite: mounting EFS puts the function inside a VPC, which
removes its route to api.openai.com and Clerk's JWKS endpoint unless you also
run a NAT gateway (~$32/month). DynamoDB needs neither.

Table shape: partition key user_id (S), sort key id (N, milliseconds-based so
a reverse query returns newest first). The audit trail lives on the item as a
list, which keeps a consultation to a single read.
"""

import os
import random
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

from db import now, valid_email  # noqa: F401  (shared helpers, re-exported)

TABLE_NAME = os.getenv("DYNAMODB_TABLE", "medinotes-consultations")

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def init_db() -> None:
    """Nothing to create at runtime — the table is infrastructure."""


def new_id() -> int:
    """Time-ordered id that stays inside JavaScript's safe integer range."""
    return int(time.time() * 1000) * 100 + random.randint(0, 99)


def _plain(value):
    """boto3 hands back Decimal for every number; JSON does not want that."""
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


def _audit_entry(action: str, detail=None) -> dict:
    return {"action": action, "detail": detail, "created_at": now()}


def create_consultation(user_id: str, patient_name: str, date_of_visit: str,
                        notes: str, patient_email: str = None) -> int:
    stamp = now()
    consultation_id = new_id()
    table().put_item(
        Item={
            "user_id": user_id,
            "id": consultation_id,
            "patient_name": patient_name,
            "patient_email": patient_email,
            "date_of_visit": date_of_visit,
            "notes": notes,
            "summary": "",
            "status": "generating",
            "emailed_at": None,
            "created_at": stamp,
            "updated_at": stamp,
            "audit": [_audit_entry("generate", patient_name)],
        }
    )
    return consultation_id


def save_summary(user_id: str, consultation_id: int, summary: str) -> None:
    table().update_item(
        Key={"user_id": user_id, "id": consultation_id},
        UpdateExpression="SET #s = :summary, #st = :status, #u = :updated",
        ExpressionAttributeNames={"#s": "summary", "#st": "status", "#u": "updated_at"},
        ExpressionAttributeValues={
            ":summary": summary,
            ":status": "draft",
            ":updated": now(),
        },
    )


def list_consultations(user_id: str, query: str = "", limit: int = 100) -> list[dict]:
    kwargs = {
        "KeyConditionExpression": boto3.dynamodb.conditions.Key("user_id").eq(user_id),
        "ScanIndexForward": False,  # newest first
        "Limit": limit,
        "ProjectionExpression": "#id, #pn, #pe, #dv, #st, #ea, #ca, #n",
        "ExpressionAttributeNames": {
            "#id": "id", "#pn": "patient_name", "#pe": "patient_email",
            "#dv": "date_of_visit", "#st": "status", "#ea": "emailed_at",
            "#ca": "created_at", "#n": "notes",
        },
    }
    if query:
        # ponytail: filter runs after the page is read, which is fine at a
        # clinician's volume. Add a GSI on patient_name if that stops holding.
        kwargs["FilterExpression"] = boto3.dynamodb.conditions.Attr("patient_name").contains(query)

    rows = table().query(**kwargs).get("Items", [])
    result = []
    for row in rows:
        row = _plain(row)
        row["notes_preview"] = (row.pop("notes", "") or "")[:160]
        result.append(row)
    return result


def get_consultation(user_id: str, consultation_id: int) -> dict | None:
    item = table().get_item(
        Key={"user_id": user_id, "id": consultation_id}
    ).get("Item")
    if item is None:
        return None
    record = _plain(item)
    record["audit"] = list(reversed(record.get("audit", [])))[:50]
    return record


def update_consultation(user_id: str, consultation_id: int,
                        summary: str = None, patient_email: str = None) -> bool:
    sets, names, values = ["#u = :updated"], {"#u": "updated_at"}, {":updated": now()}
    if summary is not None:
        sets.append("#s = :summary")
        names["#s"] = "summary"
        values[":summary"] = summary
    if patient_email is not None:
        sets.append("#pe = :email")
        names["#pe"] = "patient_email"
        values[":email"] = patient_email
    if len(sets) == 1:
        return True

    names["#a"] = "audit"
    values[":entry"] = [
        _audit_entry("edit", "summary edited" if summary is not None else "patient email set")
    ]
    values[":empty"] = []

    try:
        table().update_item(
            Key={"user_id": user_id, "id": consultation_id},
            UpdateExpression=(
                f"SET {', '.join(sets)}, #a = list_append(if_not_exists(#a, :empty), :entry)"
            ),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(user_id)",
        )
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def mark_emailed(user_id: str, consultation_id: int, recipient: str) -> None:
    stamp = now()
    table().update_item(
        Key={"user_id": user_id, "id": consultation_id},
        UpdateExpression=(
            "SET #st = :status, #ea = :stamp, #pe = :email, #u = :stamp,"
            " #a = list_append(if_not_exists(#a, :empty), :entry)"
        ),
        ExpressionAttributeNames={
            "#st": "status", "#ea": "emailed_at", "#pe": "patient_email",
            "#u": "updated_at", "#a": "audit",
        },
        ExpressionAttributeValues={
            ":status": "emailed",
            ":stamp": stamp,
            ":email": recipient,
            ":entry": [_audit_entry("email_sent", recipient)],
            ":empty": [],
        },
    )


def delete_consultation(user_id: str, consultation_id: int) -> bool:
    try:
        table().delete_item(
            Key={"user_id": user_id, "id": consultation_id},
            ConditionExpression="attribute_exists(user_id)",
        )
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def stats(user_id: str) -> dict:
    rows = table().query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id),
        ProjectionExpression="#st, #ca",
        ExpressionAttributeNames={"#st": "status", "#ca": "created_at"},
    ).get("Items", [])

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="seconds")
    return {
        "total": len(rows),
        "emailed": sum(1 for row in rows if row.get("status") == "emailed"),
        "last_7_days": sum(1 for row in rows if (row.get("created_at") or "") >= cutoff),
    }
