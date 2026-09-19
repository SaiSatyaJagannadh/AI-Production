# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Ed Donner's "AI in Production" course repo. Most of it is **instructional markdown** (`week1/`–`week4/`, `guides/*.ipynb`, `community_contributions/`) that walks a student through building and deploying apps. Three directories contain runnable code:

| Dir | Stack | Deploy target |
|---|---|---|
| `instant/` | Single-file FastAPI returning HTML | Vercel (`vercel.json` routes all traffic to `instant.py`) |
| `saas/` | Next.js (Pages Router) static export + FastAPI | Vercel **and** Docker → ECR → AWS Lambda |
| `finale/` | Strands agents on AWS Bedrock AgentCore, `uv` project | AWS (`agentcore launch`) |

`week3/` and `week4/` are pointers to other repos (`ed-donner/cyber`, `alex`) — no code for them here.

## Commands

```bash
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

There are no tests in this repo.

## saas architecture

### Two backends, one of them stale

`saas/api/` holds two different FastAPI apps for two deploy targets:

- **`api/server.py`** — the live one. Serves `POST /api/consultation`, `GET /health`, and the static Next export mounted at `/`. This is what the Dockerfile copies and what Lambda runs.
- **`api/index.py`** — the earlier Vercel Python Serverless Function, reachable at `/api` (Vercel maps `api/index.py` → `/api`, so the route inside is declared `@app.post("/api")`, not `/`).

`pages/product.tsx` posts to **`/api/consultation`**, which only `server.py` serves. On the Vercel deployment that path 404s (`/api` answers, `/api/consultation` does not). So the container/Lambda path is the working one; either update `api/index.py` and Vercel routing or treat Vercel as the marketing-site-only deploy.

### Static export changes what's possible

`next.config.ts` sets `output: 'export'`, so `npm run build` emits `out/` and there is **no SSR, no middleware, and no Next API routes** — adding a `pages/api/*` handler silently does nothing. Consequences worth remembering:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is baked in at build time, which is why the Dockerfile takes it as a `--build-arg` in the frontend stage. Changing Clerk keys means rebuilding the image, not just restarting the container.
- `npm run dev` gives you the UI with no API behind it. To exercise the full app, build and run the container (or `npm run build` then `uvicorn api.server:app`).

### Request flow

1. `pages/product.tsx` gets a Clerk JWT via `useAuth().getToken()`.
2. It POSTs to `/api/consultation` with `@microsoft/fetch-event-source` (not `fetch`, because SSE-over-POST needs it) and appends each `ev.data` chunk to a buffer rendered by `react-markdown`.
3. `server.py` verifies the JWT with `fastapi-clerk-auth` against `CLERK_JWKS_URL`, then streams OpenAI chunks back as SSE.

**SSE newline quirk:** SSE strips newlines, so `event_stream()` re-encodes each newline as a `data:  \n` line (two trailing spaces) and the frontend restores breaks with `remark-breaks`. If rendered markdown suddenly collapses into one paragraph, that encode/decode pair is where to look.

**Streaming on Lambda** depends on the Lambda Web Adapter layer baked into the Dockerfile plus `ENV AWS_LWA_INVOKE_MODE=response_stream`. Drop either and the SSE response buffers until the request completes.

**Route order in `server.py` matters:** the `app.mount("/", StaticFiles(...))` call must stay last, or it swallows `/api/consultation` and `/health`.

The model prompt lives in `system_prompt` (duplicated in both backend files) and is contractual with the UI: it must produce exactly three `###` sections (summary / next steps / patient email), because `pages/product.tsx` splits the stream on those headings to render per-section copy buttons.

Auth and billing are both Clerk: `<ClerkProvider>` wraps the app in `pages/_app.tsx`; `<Protect plan="premium_subscription">` in `product.tsx` gates the app behind Clerk's `<PricingTable />`.

### Environment variables

Everything matching `.env*` is gitignored. `saas/.env` is the one the shell commands above expect to be sourced; `saas/.env.local` is Vercel's; `saas/.env.pass` holds live AWS credentials — never echo it into output or a commit.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — build-time, baked into the export
- `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`, `OPENAI_API_KEY` — runtime, backend
- `DEFAULT_AWS_REGION`, `AWS_ACCOUNT_ID` — used by the ECR/Lambda commands

Note `.env.local` currently spells it `CLERK_JWKS_KEY`; the code reads `CLERK_JWKS_URL`. A 401 from every request usually means that name drifted again.

### Conventions

- Pages Router (`pages/`), not App Router — week 2's material uses App Router, this app does not. Don't add an `app/` directory.
- Tailwind v4 via `@import "tailwindcss"` in `styles/globals.css`; there is no `tailwind.config.js`. Theme colors are CSS custom properties on `:root` (with a `prefers-color-scheme: dark` block) exposed to Tailwind through `@theme inline` — so `bg-surface`, `text-muted`, `border-line`, `bg-accent` are project tokens, not stock Tailwind. Shared input styling is the `.field` class, which also restyles `react-datepicker` (it ships light-only CSS).
- `saas/AGENTS.md` is generated by `next dev` and re-added automatically; commit it with your work rather than fighting it. `saas/CLAUDE.md` just includes it.
