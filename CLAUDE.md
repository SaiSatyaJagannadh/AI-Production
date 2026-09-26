# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Ed Donner's "AI in Production" course repo. Most of it is **instructional markdown** (`week1/`–`week4/`, `guides/*.ipynb`, `community_contributions/`) that walks a student through building and deploying apps. Four directories contain runnable code:

| Dir | Stack | Deploy target |
|---|---|---|
| `instant/` | Single-file FastAPI returning HTML | Vercel (`vercel.json` routes all traffic to `instant.py`) |
| `saas/` | Next.js (Pages Router) static export + FastAPI | Vercel **and** Docker → ECR → AWS Lambda |
| `twin/` | Next.js **App Router** + FastAPI chat backend (week 2) | **local only so far** — see below |
| `finale/` | Strands agents on AWS Bedrock AgentCore, `uv` project | AWS (`agentcore launch`) |

`week3/` and `week4/` are pointers to other repos (`ed-donner/cyber`, `alex`) — no code for them here.

Only **one** thing is actually deployed: the `consultation-app` Lambda in us-east-2 (that is `saas/`). `twin/` has Lambda scaffolding but no function exists yet, and `instant/` and `finale/` are exercises. Check before assuming a change reaches production.

## Commands

```bash
# twin/ — backend then frontend, in two terminals
cd twin/backend && uv sync && uv run uvicorn server:app --reload --port 8000
cd twin/frontend && npm install && npm run dev   # needs NEXT_PUBLIC_API_URL in .env.local
# twin has no tests; verify by chatting, then reloading the page (history should survive)

# saas/ frontend
cd saas
npm install
npm run dev            # Next dev server — no backend, see "two backends" below
npm run build          # type-check + static export into out/
npm run lint           # eslint (flat config, eslint.config.mjs)

# saas/ backend, run directly — API only (it serves static/, which exists only inside the image)
uvicorn api.server:app --reload --port 8000

# saas/ container (env vars come from saas/.env)
docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" -t consultation-app .
docker run -p 8000:8000 \
  -e CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
  -e CLERK_JWKS_URL="$CLERK_JWKS_URL" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" consultation-app

# saas/ ship the container to Lambda
aws ecr get-login-password --region $DEFAULT_AWS_REGION | docker login --username AWS \
  --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$DEFAULT_AWS_REGION.amazonaws.com
docker build --platform linux/amd64 --provenance=false \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" -t consultation-app .
docker tag consultation-app:latest $AWS_ACCOUNT_ID.dkr.ecr.$DEFAULT_AWS_REGION.amazonaws.com/consultation-app:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$DEFAULT_AWS_REGION.amazonaws.com/consultation-app:latest
aws lambda update-function-code --function-name consultation-app \
  --image-uri $AWS_ACCOUNT_ID.dkr.ecr.$DEFAULT_AWS_REGION.amazonaws.com/consultation-app:latest \
  --region $DEFAULT_AWS_REGION

# saas/ or instant/ — Vercel
vercel --prod          # projects already linked via .vercel/project.json

# finale/
uv sync
uv run <file>.py                                   # local server on :8080
uv run agentcore configure -e <file>.py --region us-west-2
uv run agentcore launch
uv run agentcore invoke '{"prompt": "..."}'
```

`--platform linux/amd64 --provenance=false` is not optional on Apple Silicon — Lambda rejects both an arm64 image and the provenance manifest.

Backend self-check (no framework, asserts only — run after touching `db.py`, `mailer.py` or the prompt). It covers the SQLite backend, user scoping, email extraction and HTML escaping; `dynamo.py` has no offline test, so exercise it against the real table:

```bash
cd saas && python3 api/test_db.py
```

There are no frontend tests.

## Verifying a change actually works

The recurring failure mode here is *"fine in `next dev`, broken in the container"*, and it has bitten three separate ways: the `/product` 404 (static export writes `.html`, the mount serves directories), the LinkedIn PDF vanishing (case-sensitive filesystem), and a Clerk key baked in at build time. `next dev` proves almost nothing about production for these apps.

For a saas change, the real check is: `npm run build` → `docker build` → `docker run` → hit the container. For twin, run the backend from `twin/backend/` and confirm the persona loaded (an empty or generic reply usually means `resources.py` found nothing).

## twin architecture (week 2)

A personal "digital twin" chat: `twin/frontend` (App Router) talks to `twin/backend` (FastAPI) over plain JSON — no streaming, unlike saas.

**The persona is assembled at import, not hardcoded.** `resources.py` reads `backend/data/` (LinkedIn PDF via pypdf, `summary.txt`, `style.txt`, `facts.json`); `context.py` interpolates those into one large system prompt. Editing the twin's personality means editing those data files, not the Python. Two traps live here, both already fixed once:

- Paths resolve from `Path(__file__).parent`, never the working directory — the server runs from `backend/` locally and `/var/task` on Lambda.
- The PDF lookup is case-insensitive because the file is committed as `Linkedin.pdf` while the code asked for `linkedin.pdf`. On macOS that resolves; on Lambda's Linux filesystem it silently degrades to "LinkedIn profile not available", and the twin gets vague without any error.

**Memory** is per-session JSON, keyed by a `session_id` the backend mints on the first message: local files under `MEMORY_DIR` (default `twin/memory/`, gitignored — real transcripts) or S3 objects when `USE_S3=true` and `S3_BUCKET` is set. Only the **last 10 messages** are replayed into the prompt, so long conversations lose their early context by design.

The frontend keeps that `session_id` in `localStorage` and re-fetches `GET /conversation/{id}` on load, which is why a refresh keeps the thread. `components/api.ts` holds the fetch layer and reads `NEXT_PUBLIC_API_URL` — note it is in `components/`, not `lib/`, because the root `.gitignore`'s Python `lib/` rule would swallow it (`saas/lib/` needed an explicit negation).

`lambda_handler.py` wraps the app in Mangum, and `uv run deploy.py` builds `lambda-deployment.zip` by pip-installing into the official Lambda image (so the wheels are manylinux x86_64, not macOS arm64). **It stops at the zip** — there is no upload step and no Lambda function for the twin yet, so deploying means creating the function and uploading by hand. The zip lands around 29 MB against Lambda's 50 MB limit for a direct upload, so it goes via S3 or a container image if it grows.

Unlike saas, this backend does **not** serve the frontend — they deploy separately, so CORS matters (`CORS_ORIGINS`, comma-separated).

## saas architecture

### Two backends, one of them stale

`saas/api/` holds two different FastAPI apps for two deploy targets:

- **`api/server.py`** — the live one, with `api/db.py`, `api/dynamo.py` and `api/mailer.py` beside it. Serves the whole API plus the static Next export mounted at `/`. The Dockerfile copies those four files by name, so **a new module is invisible to the container until you add it to that COPY line**.
- **`api/index.py`** — the earlier Vercel Python Serverless Function, reachable at `/api` (Vercel maps `api/index.py` → `/api`, so the route inside is declared `@app.post("/api")`, not `/`). It has drifted a long way: three prompt sections instead of four (no red flags), and no knowledge of persistence, email or the audit trail. Treat it as dead code unless you deliberately revive it.

`pages/product.tsx` posts to **`/api/consultation`**, which only `server.py` serves. On the Vercel deployment that path 404s (`/api` answers, `/api/consultation` does not). So the container/Lambda path is the working one; either update `api/index.py` and Vercel routing or treat Vercel as the marketing-site-only deploy.

Endpoints, all guarded by the Clerk JWT: `POST /api/consultation` (stream + persist), `GET /api/consultations` (list, `?q=` searches patient name), `GET|PATCH|DELETE /api/consultations/{id}` (PATCH also takes `sent_externally`), `POST /api/consultations/{id}/email`, `GET /api/stats`, `GET /health`.

### Two storage backends, chosen at import

`server.py` picks one at import time and nothing downstream changes, because both modules expose the same ten functions:

```python
if os.getenv("DYNAMODB_TABLE"):
    import dynamo as db
else:
    import db
```

- **`api/db.py`** — stdlib `sqlite3` at `DB_PATH` (default `/tmp/medinotes.db`). The local and test path.
- **`api/dynamo.py`** — DynamoDB, partition key `user_id`, sort key `id` (a millisecond-based int, so a reverse query returns newest first and the value still fits JavaScript's safe integer range). The audit trail is a list attribute on the item, so a consultation is one read. boto3 returns `Decimal` for every number — `_plain()` converts before the response is serialized.

**Every function in both takes the Clerk user id from the verified token and filters on it.** That scoping is the only thing standing between two clinicians' records, so never add a query without it; `test_db.py` asserts it.

Why not EFS + SQLite, the obvious answer to "make it durable": mounting EFS requires the function to be in a VPC, and a VPC without a NAT gateway (~$32/month) has no route to `api.openai.com` or Clerk's JWKS endpoint. DynamoDB needs neither.

### Email, and the fallback when there is no relay

`api/mailer.py` sends over plain `smtplib` — any SMTP relay (SES, SendGrid, Postmark, a Gmail app password) via the `SMTP_*` variables. It is only ever reached from the email endpoint, which only an explicit click calls.

`missing_config()` returns the list of settings still absent and drives everything user-facing: `/api/stats` returns it as `email_missing`, and the composer names them. It deliberately treats "`SMTP_USER` set but no `SMTP_PASSWORD`" as unconfigured — otherwise the UI reports ready and the send fails at the relay as an opaque 502.

When no relay is configured the composer does not dead-end. It offers `mailto:` and Gmail compose links built by `composeLinks()` in `lib/api.ts`, and **`PATCH /api/consultations/{id}` with `sent_externally: true`** records a send the clinician made from their own mail client — nothing is transmitted, only a status change and an audit entry reading "sent from the clinician's own mail client" so it stays distinguishable from a relay send.

### Static export changes what's possible

`next.config.ts` sets `output: 'export'`, so `npm run build` emits `out/` and there is **no SSR, no middleware, and no Next API routes** — adding a `pages/api/*` handler silently does nothing. Consequences worth remembering:

- `trailingSlash: true` is load-bearing: it makes the export write `out/product/index.html` instead of `out/product.html`, which is the only shape Starlette's `StaticFiles(html=True)` can serve at `/product`. Remove it and the app page 404s in the container while still working under `next dev`.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is baked in at build time, which is why the Dockerfile takes it as a `--build-arg` in the frontend stage. Changing Clerk keys means rebuilding the image, not just restarting the container.
- `npm run dev` gives you the UI with no API behind it. To exercise the full app, build and run the container (or `npm run build` then `uvicorn api.server:app`).

### Request flow

1. `pages/product.tsx` gets a Clerk JWT via `useAuth().getToken()`.
2. It POSTs to `/api/consultation` with `@microsoft/fetch-event-source` (not `fetch`, because SSE-over-POST needs it) and appends each `ev.data` chunk to a buffer rendered by `react-markdown`.
3. `server.py` verifies the JWT with `fastapi-clerk-auth` against `CLERK_JWKS_URL`, writes the row *before* calling the model, then streams OpenAI chunks back as SSE and saves the finished text in a `finally` block (so a dropped connection still persists the partial draft).
4. Two named SSE events carry control data: `meta` (sent first) and `done` (sent last) both hold `{"id": <row id>}`. The client must skip any `ev.event` that is not the default `message`, or the JSON lands in the markdown buffer.

**SSE newline quirk:** SSE strips newlines, so `event_stream()` re-encodes each newline as a `data:  \n` line (two trailing spaces) and the frontend restores breaks with `remark-breaks`. If rendered markdown suddenly collapses into one paragraph, that encode/decode pair is where to look.

**Streaming on Lambda** depends on the Lambda Web Adapter layer baked into the Dockerfile plus `ENV AWS_LWA_INVOKE_MODE=response_stream`. Drop either and the SSE response buffers until the request completes.

**Route order in `server.py` matters:** the `app.mount("/", StaticFiles(...))` call must stay last, or it swallows `/api/consultation` and `/health`.

The model prompt lives in `system_prompt` (duplicated in both backend files) and is contractual with the UI: four `###` sections — summary / next steps / safety netting and red flags / patient email. `lib/api.ts` splits on those headings for per-section copy buttons, highlights the red-flag card, and finds the section whose title contains "email" to prefill the composer (`mailer.patient_email_section` does the same server-side). Renaming that last heading silently empties the email draft.

Auth and billing are both Clerk: `<ClerkProvider>` wraps the app in `pages/_app.tsx`; `<Protect plan="premium_subscription">` in `product.tsx` gates the app behind Clerk's `<PricingTable />`.

### Environment variables

Everything matching `.env*` is gitignored. `saas/.env` is the one the shell commands above expect to be sourced; `saas/.env.local` is Vercel's; `saas/.env.pass` holds live AWS credentials — never echo it into output or a commit.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — build-time, baked into the export
- `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`, `OPENAI_API_KEY` — runtime, backend
- `DEFAULT_AWS_REGION`, `AWS_ACCOUNT_ID` — used by the ECR/Lambda commands
- `DYNAMODB_TABLE` — set it and the app uses DynamoDB; unset and it uses SQLite
- `DB_PATH` — SQLite file when DynamoDB is off (default `/tmp/medinotes.db`)
- twin only: `NEXT_PUBLIC_API_URL` (frontend, build-time), `CORS_ORIGINS`, `MEMORY_DIR`, `USE_S3`, `S3_BUCKET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `CLINIC_NAME` — patient email; incomplete means the send endpoint returns 503 and the composer falls back to the clinician's own mail client

Two traps in `saas/.env.local`, both already hit once:

- It spells the JWKS variable `CLERK_JWKS_KEY`; the code reads `CLERK_JWKS_URL`. A 401 on every request usually means that name drifted again.
- It contains a **second block of placeholder values** (`pk_test_...`) below the real ones. Next.js takes the last occurrence, so those placeholders win and `npm run build` dies with "The publishableKey passed to Clerk is invalid". They are commented out now; if the build fails that way again, look for a re-pasted block rather than a bad key.

### The live deployment

Account `190176595816`, region **us-east-2** (not the `us-east-1` the course examples use). Lambda function `consultation-app`, ECR repo of the same name, execution role `consultation-app-role-pchjrphk`, public Function URL:

```
https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/
```

A deploy is: `npm run build` → docker build → tag → push → `aws lambda update-function-code`. The image tag is always `:latest`, so a rollback means rebuilding from an older commit, not re-pointing a tag. `update-function-code` and `update-function-configuration` cannot overlap — `aws lambda wait function-updated` between them.

`--environment` on `update-function-configuration` **replaces the whole variable map**, so always read the current one and merge rather than passing only the keys you are changing.

The IAM user `AIEngineer` has `IAMFullAccess` but no DynamoDB rights by default; the table and the role policy have to be granted before `DYNAMODB_TABLE` will work.

### Conventions

- `saas/` is Pages Router (`pages/`); `twin/` is App Router (`app/`). Don't mix them — no `app/` directory in saas, no `pages/` in twin.
- `twin/frontend` also contains a stray `pyproject.toml` and `uv.lock` (a uv project initialised in the wrong directory). Harmless, but it is not a Python project.
- lucide-react 1.x **removed brand icons** — `Github` and `Linkedin` no longer exist and fail the build as "Export doesn't exist in target module". Use generic icons.
- Tailwind v4 via `@import "tailwindcss"` in `styles/globals.css`; there is no `tailwind.config.js`. Theme colors are CSS custom properties on `:root` (with a `prefers-color-scheme: dark` block) exposed to Tailwind through `@theme inline` — so `bg-surface`, `text-muted`, `border-line`, `bg-accent` are project tokens, not stock Tailwind. Shared input styling is the `.field` class, which also restyles `react-datepicker` (it ships light-only CSS).
- Frontend data access goes through `lib/api.ts` (typed fetch helpers that attach the JWT); `pages/product.tsx` holds only UI. Buttons use the `.btn-primary` / `.btn-ghost` classes in `globals.css`.
- The app stores patient notes and email addresses. It is a course demo, not a HIPAA-compliant system: no encryption at rest, no BAA, no retention policy. Keep that caveat in the UI and README if you extend it.
- `saas/AGENTS.md` is generated by `next dev` and re-added automatically; commit it with your work rather than fighting it. `saas/CLAUDE.md` just includes it.
