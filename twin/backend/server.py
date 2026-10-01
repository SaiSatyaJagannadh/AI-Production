from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from typing import Optional, List, Dict
import json
import uuid
from datetime import datetime
import boto3
from botocore.exceptions import ClientError
from context import prompt


# =========================================================
# Load environment variables
# =========================================================

load_dotenv()


# =========================================================
# FastAPI App
# =========================================================

app = FastAPI()


# =========================================================
# CORS Configuration
# =========================================================

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# =========================================================
# AWS Bedrock Client
# =========================================================

bedrock_client = boto3.client(
    service_name="bedrock-runtime",
    region_name=os.getenv(
        "DEFAULT_AWS_REGION",
        "us-east-1"
    )
)


# =========================================================
# Bedrock Model
# =========================================================

BEDROCK_MODEL_ID = os.getenv(
    "BEDROCK_MODEL_ID",
    "global.amazon.nova-2-lite-v1:0"
)


# =========================================================
# Memory Storage Configuration
# =========================================================

USE_S3 = (
    os.getenv("USE_S3", "false").lower()
    == "true"
)

S3_BUCKET = os.getenv(
    "S3_BUCKET",
    ""
)

MEMORY_DIR = os.getenv(
    "MEMORY_DIR",
    "../memory"
)


# =========================================================
# S3 Client
# =========================================================

if USE_S3:
    s3_client = boto3.client("s3")


# =========================================================
# Request / Response Models
# =========================================================

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    session_id: str


class Message(BaseModel):
    role: str
    content: str
    timestamp: str


# =========================================================
# Memory Functions
# =========================================================

def get_memory_path(session_id: str) -> str:
    return f"{session_id}.json"


def load_conversation(
    session_id: str
) -> List[Dict]:
    """
    Load conversation history from storage.
    """

    # -----------------------------------------------------
    # S3 Storage
    # -----------------------------------------------------

    if USE_S3:

        try:

            response = s3_client.get_object(
                Bucket=S3_BUCKET,
                Key=get_memory_path(session_id)
            )

            return json.loads(
                response["Body"]
                .read()
                .decode("utf-8")
            )

        except ClientError as e:

            error_code = (
                e.response
                .get("Error", {})
                .get("Code")
            )

            if error_code in (
                "NoSuchKey",
                "NoSuchBucket"
            ):
                return []

            raise

    # -----------------------------------------------------
    # Local Storage
    # -----------------------------------------------------

    else:

        file_path = os.path.join(
            MEMORY_DIR,
            get_memory_path(session_id)
        )

        if os.path.exists(file_path):

            with open(
                file_path,
                "r"
            ) as f:

                return json.load(f)

        return []


def save_conversation(
    session_id: str,
    messages: List[Dict]
):
    """
    Save conversation history.
    """

    # -----------------------------------------------------
    # S3 Storage
    # -----------------------------------------------------

    if USE_S3:

        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=get_memory_path(session_id),
            Body=json.dumps(
                messages,
                indent=2
            ),
            ContentType="application/json"
        )

    # -----------------------------------------------------
    # Local Storage
    # -----------------------------------------------------

    else:

        os.makedirs(
            MEMORY_DIR,
            exist_ok=True
        )

        file_path = os.path.join(
            MEMORY_DIR,
            get_memory_path(session_id)
        )

        with open(
            file_path,
            "w"
        ) as f:

            json.dump(
                messages,
                f,
                indent=2
            )


# =========================================================
# AWS Bedrock Function
# =========================================================

def call_bedrock(
    conversation: List[Dict],
    user_message: str
) -> str:
    """
    Call AWS Bedrock Converse API.
    """

    # =====================================================
    # Build Bedrock Messages
    # =====================================================

    messages = []

    # -----------------------------------------------------
    # Add Conversation History
    # -----------------------------------------------------

    for msg in conversation[-50:]:

        role = msg.get("role")
        content = msg.get(
            "content",
            ""
        )

        # Bedrock Converse messages can only have
        # user or assistant roles.
        if role not in (
            "user",
            "assistant"
        ):
            continue

        content = str(content)

        # Ignore empty messages
        if not content.strip():
            continue

        messages.append(
            {
                "role": role,
                "content": [
                    {
                        "text": content
                    }
                ]
            }
        )

    # =====================================================
    # Add Current User Message
    # =====================================================

    messages.append(
        {
            "role": "user",
            "content": [
                {
                    "text": str(user_message)
                }
            ]
        }
    )

    # =====================================================
    # System Prompt
    #
    # IMPORTANT:
    # System prompt goes in `system`.
    # It should NOT be added as a user message.
    # =====================================================

    system_prompt = [
        {
            "text": str(prompt())
        }
    ]

    # =====================================================
    # Debug Logging
    # =====================================================

    print("\n")
    print("=" * 60)
    print("BEDROCK REQUEST")
    print("=" * 60)

    print("Model:")
    print(BEDROCK_MODEL_ID)

    print("\nSystem Prompt:")
    print(system_prompt)

    print("\nMessages:")

    for message in messages:
        print(message)

    print("=" * 60)
    print("\n")

    # =====================================================
    # Call Bedrock
    # =====================================================

    try:

        response = bedrock_client.converse(

            # Model
            modelId=BEDROCK_MODEL_ID,

            # System Prompt
            system=system_prompt,

            # Conversation
            messages=messages,

            # Generation Settings
            inferenceConfig={
                "maxTokens": 2000,
                "temperature": 0.7,
                "topP": 0.9
            }
        )

        # =================================================
        # Extract Response
        # =================================================

        output = response.get(
            "output",
            {}
        )

        output_message = output.get(
            "message",
            {}
        )

        content_blocks = output_message.get(
            "content",
            []
        )

        # -------------------------------------------------
        # Find Text Response
        # -------------------------------------------------

        for block in content_blocks:

            if "text" in block:

                return block["text"]

        # -------------------------------------------------
        # Empty Response
        # -------------------------------------------------

        raise HTTPException(
            status_code=500,
            detail="Bedrock returned an empty response"
        )

    # =====================================================
    # AWS Client Error
    # =====================================================

    except ClientError as e:

        error = e.response.get(
            "Error",
            {}
        )

        error_code = error.get(
            "Code",
            "Unknown"
        )

        error_message = error.get(
            "Message",
            str(e)
        )

        print("\n")
        print("=" * 60)
        print("BEDROCK ERROR")
        print("=" * 60)

        print("Error Code:")
        print(error_code)

        print("\nError Message:")
        print(error_message)

        print("\nFull Error:")
        print(e)

        print("=" * 60)
        print("\n")

        # -------------------------------------------------
        # Validation Error
        # -------------------------------------------------

        if error_code == "ValidationException":

            raise HTTPException(
                status_code=400,
                detail=(
                    "Bedrock validation error: "
                    + error_message
                )
            )

        # -------------------------------------------------
        # Access Denied
        # -------------------------------------------------

        elif error_code == "AccessDeniedException":

            raise HTTPException(
                status_code=403,
                detail=(
                    "Access denied to Bedrock model. "
                    "Check your AWS IAM permissions "
                    "and Bedrock model access."
                )
            )

        # -------------------------------------------------
        # Model Not Found
        # -------------------------------------------------

        elif error_code == "ResourceNotFoundException":

            raise HTTPException(
                status_code=404,
                detail=(
                    "Bedrock model not found: "
                    + BEDROCK_MODEL_ID
                )
            )

        # -------------------------------------------------
        # Other AWS Errors
        # -------------------------------------------------

        else:

            raise HTTPException(
                status_code=500,
                detail=(
                    f"Bedrock error "
                    f"({error_code}): "
                    f"{error_message}"
                )
            )

    # =====================================================
    # Unexpected Error
    # =====================================================

    except Exception as e:

        print("\n")
        print("=" * 60)
        print("UNEXPECTED BEDROCK ERROR")
        print("=" * 60)

        print(str(e))

        print("=" * 60)
        print("\n")

        raise HTTPException(
            status_code=500,
            detail=(
                "Unexpected Bedrock error: "
                + str(e)
            )
        )


# =========================================================
# Root Endpoint
# =========================================================

@app.get("/")
async def root():

    return {
        "message": (
            "AI Digital Twin API "
            "(Powered by AWS Bedrock)"
        ),
        "memory_enabled": True,
        "storage": (
            "S3"
            if USE_S3
            else "local"
        ),
        "ai_model": BEDROCK_MODEL_ID
    }


# =========================================================
# Health Check
# =========================================================

@app.get("/health")
async def health_check():

    return {
        "status": "healthy",
        "use_s3": USE_S3,
        "bedrock_model": BEDROCK_MODEL_ID
    }


# =========================================================
# Chat Endpoint
# =========================================================

@app.post(
    "/chat",
    response_model=ChatResponse
)
async def chat(
    request: ChatRequest
):

    try:

        # -------------------------------------------------
        # Create Session ID
        # -------------------------------------------------

        session_id = (
            request.session_id
            or str(uuid.uuid4())
        )

        # -------------------------------------------------
        # Load Previous Conversation
        # -------------------------------------------------

        conversation = load_conversation(
            session_id
        )

        # -------------------------------------------------
        # Call Bedrock
        # -------------------------------------------------

        assistant_response = call_bedrock(
            conversation,
            request.message
        )

        # -------------------------------------------------
        # Save User Message
        # -------------------------------------------------

        conversation.append(
            {
                "role": "user",
                "content": request.message,
                "timestamp": (
                    datetime.now()
                    .isoformat()
                )
            }
        )

        # -------------------------------------------------
        # Save Assistant Message
        # -------------------------------------------------

        conversation.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "timestamp": (
                    datetime.now()
                    .isoformat()
                )
            }
        )

        # -------------------------------------------------
        # Save Conversation
        # -------------------------------------------------

        save_conversation(
            session_id,
            conversation
        )

        # -------------------------------------------------
        # Return Response
        # -------------------------------------------------

        return ChatResponse(
            response=assistant_response,
            session_id=session_id
        )

    # =====================================================
    # FastAPI HTTP Exception
    # =====================================================

    except HTTPException:
        raise

    # =====================================================
    # Unexpected Error
    # =====================================================

    except Exception as e:

        print(
            "Error in chat endpoint:",
            str(e)
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================================================
# Get Conversation
# =========================================================

@app.get(
    "/conversation/{session_id}"
)
async def get_conversation(
    session_id: str
):

    try:

        conversation = load_conversation(
            session_id
        )

        return {
            "session_id": session_id,
            "messages": conversation
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================================================
# Start Application
# =========================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )