"""Patient email delivery over SMTP — stdlib smtplib, no provider SDK.

Works with any SMTP relay (Amazon SES, SendGrid, Postmark, Gmail app password):
set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM.

Nothing here is ever called automatically. The clinician reviews the draft and
presses Send; the API endpoint is the only caller.
"""

import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from html import escape

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
CLINIC_NAME = os.getenv("CLINIC_NAME", "MediNotes Pro")

BULLET_RE = re.compile(r"^([-*]|\d+\.)\s+")


class EmailNotConfigured(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def markdown_to_html(text: str) -> str:
    """Minimal markdown → HTML for email bodies: bold, bullets, paragraphs.

    Deliberately not a markdown library — email clients only get simple markup
    from us, and escaping first means patient text can never inject HTML.
    """
    blocks = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        if all(BULLET_RE.match(line) for line in lines):
            items = "".join(
                "<li>" + _inline(BULLET_RE.sub("", line)) + "</li>" for line in lines
            )
            blocks.append(f"<ul style='margin:0 0 16px;padding-left:20px'>{items}</ul>")
        else:
            body = "<br/>".join(_inline(line) for line in lines)
            blocks.append(f"<p style='margin:0 0 16px;line-height:1.6'>{body}</p>")
    return "".join(blocks)


def _inline(line: str) -> str:
    safe = escape(line)
    safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
    return re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", safe)


def patient_email_section(summary: str) -> str:
    """Pull the patient-facing section out of the generated markdown draft."""
    for part in summary.split("### "):
        title, _, body = part.partition("\n")
        if "email" in title.lower():
            return body.strip()
    return ""


def build_message(to: str, subject: str, body: str, clinician: str = "") -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{CLINIC_NAME} <{SMTP_FROM}>"
    message["To"] = to

    footer = (
        "This message was prepared and reviewed by your clinician. "
        "If anything is unclear, or your symptoms get worse, please contact the "
        "practice. Do not reply to this address in an emergency."
    )
    signature = f"\n\n{clinician}\n{CLINIC_NAME}" if clinician else f"\n\n{CLINIC_NAME}"

    message.set_content(f"{body}{signature}\n\n---\n{footer}")
    message.add_alternative(
        f"""<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
             color:#0d1b23;max-width:600px;margin:0 auto;padding:24px">
          {markdown_to_html(body)}
          <p style="margin:24px 0 0;line-height:1.6">{escape(clinician or CLINIC_NAME)}</p>
          <hr style="border:0;border-top:1px solid #dfe6ea;margin:24px 0"/>
          <p style="font-size:13px;color:#5b6b76;line-height:1.6">{footer}</p>
        </body></html>""",
        subtype="html",
    )
    return message


def send(to: str, subject: str, body: str, clinician: str = "") -> None:
    """Send one patient email. Raises EmailNotConfigured or smtplib errors."""
    if not is_configured():
        raise EmailNotConfigured(
            "SMTP is not configured — set SMTP_HOST, SMTP_FROM and credentials."
        )

    message = build_message(to, subject, body, clinician)
    context = ssl.create_default_context()

    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.starttls(context=context)
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
