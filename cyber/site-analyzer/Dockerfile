FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 PORT=8000

# semgrep goes in the system Python, not the app's venv: its pinned
# opentelemetry versions conflict with current FastAPI.
RUN pip install --no-cache-dir uv==0.12.18 semgrep==1.182.1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app/ ./
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
