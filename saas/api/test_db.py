"""Self-check for the persistence and email helpers: python api/test_db.py

No framework — asserts only. Run it after touching db.py, mailer.py or the
section-splitting in server.py.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ["DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")

import db  # noqa: E402
import mailer  # noqa: E402

SUMMARY = """### Summary of visit for the doctor's records
Three-day cough, chest clear.

### Next steps for the doctor
- Repeat BP in two weeks

### Safety netting and red flags
- Breathlessness at rest

### Draft of email to patient in patient-friendly language
Thanks for coming in today. Your chest sounded clear.
"""


def test_scoping_and_crud():
    db.init_db()
    mine = db.create_consultation("user_a", "Jordan Ellis", "2026-09-19", "cough 3/7")
    theirs = db.create_consultation("user_b", "Someone Else", "2026-09-19", "other notes")

    db.save_summary("user_a", mine, SUMMARY)
    record = db.get_consultation("user_a", mine)
    assert record["summary"] == SUMMARY
    assert record["status"] == "draft"

    # A different clinician can never read or edit the row.
    assert db.get_consultation("user_b", mine) is None
    assert db.update_consultation("user_b", mine, summary="hacked") is False
    assert db.delete_consultation("user_b", mine) is False
    assert db.get_consultation("user_a", mine)["summary"] == SUMMARY

    # Listing is scoped and searchable.
    assert [c["id"] for c in db.list_consultations("user_a")] == [mine]
    assert db.list_consultations("user_a", "Jordan") != []
    assert db.list_consultations("user_a", "Nobody") == []

    # Edits and email status.
    assert db.update_consultation("user_a", mine, patient_email="j@example.com") is True
    db.mark_emailed("user_a", mine, "j@example.com")
    emailed = db.get_consultation("user_a", mine)
    assert emailed["status"] == "emailed" and emailed["emailed_at"]
    assert [entry["action"] for entry in emailed["audit"]][0] == "email_sent"

    assert db.stats("user_a") == {"total": 1, "emailed": 1, "last_7_days": 1}
    assert db.delete_consultation("user_a", mine) is True
    assert db.get_consultation("user_a", mine) is None
    assert db.get_consultation("user_b", theirs) is not None


def test_email_validation():
    assert db.valid_email("doctor@clinic.org")
    assert not db.valid_email("")
    assert not db.valid_email("not-an-email")
    assert not db.valid_email("two@@example.com")


def test_patient_section_extraction():
    body = mailer.patient_email_section(SUMMARY)
    assert body.startswith("Thanks for coming in today")
    assert "Repeat BP" not in body
    assert mailer.patient_email_section("no headings here") == ""


def test_email_html_escapes_content():
    html = mailer.markdown_to_html("**Take care** <script>alert(1)</script>\n\n- rest up")
    assert "<strong>Take care</strong>" in html
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "<li>rest up</li>" in html


if __name__ == "__main__":
    test_scoping_and_crud()
    test_email_validation()
    test_email_html_escapes_content()
    test_patient_section_extraction()
    print("all checks passed")
