import json
import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer, HTTPAuthorizationCredentials
from openai import OpenAI

# Importable both as `uvicorn server:app` (flat, inside the container) and as
# `uvicorn api.server:app` (from the project root during local development).
sys.path.insert(0, str(Path(__file__).parent))
import mailer  # noqa: E402

# DynamoDB when a table is configured (Lambda), SQLite otherwise (local/dev).
# Both modules expose the same functions, so nothing below this line changes.
if os.getenv("DYNAMODB_TABLE"):
    import dynamo as db  # noqa: E402
else:
    import db  # noqa: E402

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

clerk_config = ClerkConfig(jwks_url=os.getenv("CLERK_JWKS_URL"))
clerk_guard = ClerkHTTPBearer(clerk_config)

db.init_db()


class Visit(BaseModel):
    patient_name: str = Field(..., min_length=1, max_length=200)
    date_of_visit: str = Field(..., max_length=32)
    notes: str = Field(..., min_length=1, max_length=20000)
    patient_email: str | None = Field(None, max_length=320)


class ConsultationUpdate(BaseModel):
    summary: str | None = Field(None, max_length=40000)
    patient_email: str | None = Field(None, max_length=320)


class EmailRequest(BaseModel):
    to: str | None = Field(None, max_length=320)
    subject: str | None = Field(None, max_length=200)
    body: str | None = Field(None, max_length=40000)


system_prompt = """
You are provided with notes written by a doctor from a patient's visit.
Your job is to summarize the visit for the doctor and provide an email.
Reply with exactly four sections with the headings:
### Summary of visit for the doctor's records
### Next steps for the doctor
### Safety netting and red flags
### Draft of email to patient in patient-friendly language

Under "Safety netting and red flags", list the specific symptoms or findings that
should prompt urgent review, and flag anything in the notes that looks time-critical.
If nothing stands out, say so plainly rather than inventing concerns.

The patient email section is sent as-is, so write the message body only: no subject
line, no "Dear [Name]" or "[Your Name]" placeholders, and no sign-off — the greeting
uses the patient's real name and the signature and footer are added automatically.
"""


def user_prompt_for(visit: Visit) -> str:
    return f"""Create the summary, next steps and draft email for:
Patient Name: {visit.patient_name}
Date of Visit: {visit.date_of_visit}
Notes:
{visit.notes}"""


def current_user(creds: HTTPAuthorizationCredentials) -> tuple[str, str]:
    """(user_id, display name) from the verified Clerk token."""
    claims = creds.decoded
    name = claims.get("name") or claims.get("full_name") or ""
    return claims["sub"], name


@app.post("/api/consultation")
def consultation_summary(
    visit: Visit,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id, _ = current_user(creds)
    # Recorded before the model runs, so a dropped connection still leaves a row.
    consultation_id = db.create_consultation(
        user_id, visit.patient_name, visit.date_of_visit, visit.notes, visit.patient_email
    )

    client = OpenAI()
    stream = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt_for(visit)},
        ],
        stream=True,
    )

    def event_stream():
        collected = []
        # A named event, so the client can pick up the id without it landing in
        # the markdown buffer.
        yield f"event: meta\ndata: {json.dumps({'id': consultation_id})}\n\n"
        try:
            for chunk in stream:
                text = chunk.choices[0].delta.content
                if text:
                    collected.append(text)
                    lines = text.split("\n")
                    for line in lines[:-1]:
                        yield f"data: {line}\n\n"
                        yield "data:  \n"
                    yield f"data: {lines[-1]}\n\n"
        finally:
            # Runs on client disconnect too, so partial drafts are not lost.
            db.save_summary(user_id, consultation_id, "".join(collected))
        yield f"event: done\ndata: {json.dumps({'id': consultation_id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/consultations")
def list_consultations(
    q: str = "",
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id, _ = current_user(creds)
    return {"consultations": db.list_consultations(user_id, q.strip()[:100])}


@app.get("/api/consultations/{consultation_id}")
def get_consultation(
    consultation_id: int,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id, _ = current_user(creds)
    record = db.get_consultation(user_id, consultation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Consultation not found")
    return record


@app.patch("/api/consultations/{consultation_id}")
def update_consultation(
    consultation_id: int,
    update: ConsultationUpdate,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id, _ = current_user(creds)
    if update.patient_email and not db.valid_email(update.patient_email):
        raise HTTPException(status_code=400, detail="That email address is not valid")
    if not db.update_consultation(
        user_id, consultation_id, update.summary, update.patient_email
    ):
        raise HTTPException(status_code=404, detail="Consultation not found")
    return {"status": "saved"}


@app.delete("/api/consultations/{consultation_id}")
def delete_consultation(
    consultation_id: int,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    user_id, _ = current_user(creds)
    if not db.delete_consultation(user_id, consultation_id):
        raise HTTPException(status_code=404, detail="Consultation not found")
    return {"status": "deleted"}


@app.post("/api/consultations/{consultation_id}/email")
def email_patient(
    consultation_id: int,
    request: EmailRequest,
    creds: HTTPAuthorizationCredentials = Depends(clerk_guard),
):
    """Send the reviewed draft to the patient. Only ever called by an explicit
    clinician action in the UI — nothing here runs automatically."""
    user_id, clinician = current_user(creds)
    record = db.get_consultation(user_id, consultation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Consultation not found")

    recipient = (request.to or record["patient_email"] or "").strip()
    if not db.valid_email(recipient):
        raise HTTPException(status_code=400, detail="A valid patient email is required")

    body = (request.body or mailer.patient_email_section(record["summary"])).strip()
    if not body:
        raise HTTPException(status_code=400, detail="There is no email draft to send yet")

    subject = request.subject or f"Your visit summary — {record['date_of_visit']}"

    try:
        mailer.send(recipient, subject, body, clinician)
    except mailer.EmailNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # SMTP failures: report, don't mark as sent
        raise HTTPException(status_code=502, detail=f"The email could not be sent: {exc}")

    db.mark_emailed(user_id, consultation_id, recipient)
    return {"status": "sent", "to": recipient, "subject": subject}


@app.get("/api/stats")
def get_stats(creds: HTTPAuthorizationCredentials = Depends(clerk_guard)):
    user_id, _ = current_user(creds)
    return {
        **db.stats(user_id),
        "email_configured": mailer.is_configured(),
        "email_missing": mailer.missing_config(),
    }


@app.get("/health")
def health_check():
    """Health check endpoint (used for local Docker; Lambda does not invoke it)"""
    return {"status": "healthy"}


# Serve static files (our Next.js export) - MUST BE LAST!
static_path = Path("static")
if static_path.exists():
    @app.get("/")
    async def serve_root():
        return FileResponse(static_path / "index.html")

    app.mount("/", StaticFiles(directory="static", html=True), name="static")
