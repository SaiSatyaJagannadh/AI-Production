# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Cybersecurity Analyzer**, the week 3 project of Ed Donner's "AI in Production" course, vendored into `production-main/cyber/` from `ed-donner/cyber` (its `.git` was removed, so it is plain files in the parent repo, not a submodule, and `git pull` will not fetch Ed's updates). A visitor uploads or pastes Python; an OpenAI Agents SDK agent runs Semgrep over it through an MCP server, adds its own review, and returns a structured report sorted by CVSS.

The step-by-step guides are in `week3/`: `day1.part0` (local + Docker), `day1.part1`/`part2` (Azure Container Apps), `day2.part1`/`part2` (GCP Cloud Run). Ed's original notes assumed the project lives at `~/projects/cyber` and that students may be on Windows, Mac or Linux — guide instructions should keep working on all three.

## Commands

`.env` lives in this folder (`cyber/.env`, gitignored) with `OPENAI_API_KEY` and `SEMGREP_APP_TOKEN`. `load_dotenv()` walks up from `backend/`, so it is found without being copied.

```bash
# local, two terminals
cd backend && uv run server.py          # API on :8000
cd frontend && npm install && npm run dev   # UI on :3000

# quality — there are no tests
cd frontend && npm run lint && npx tsc --noEmit   # there is no `typecheck` script

# smoke test the API (takes ~30 s; the first run after a fresh install often times out in Semgrep — retry)
curl -X POST localhost:8000/api/analyze -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json;print(json.dumps({"code":open("airline.py").read()}))')"

# single container (frontend + API on :8000)
docker build -t cyber-analyzer .
docker run --rm --name cyber-analyzer -p 8000:8000 --env-file .env cyber-analyzer

# cloud — workspace name matches the folder (azure | gcp); GCP also needs TF_VAR_project_id
cd terraform/azure && terraform init && terraform workspace new azure
terraform apply   -var="openai_api_key=$OPENAI_API_KEY" -var="semgrep_app_token=$SEMGREP_APP_TOKEN"
terraform output app_url
terraform destroy -var="openai_api_key=$OPENAI_API_KEY" -var="semgrep_app_token=$SEMGREP_APP_TOKEN"
```

`airline.py` at the root is the deliberately vulnerable sample to analyze (SQL injection, `eval`).

**Port 8000 is shared with `twin/` and `saas/` in the parent repo.** On macOS a twin `uvicorn` bound to `127.0.0.1:8000` and this server bound to `0.0.0.0:8000` can both start, and `localhost` reaches the twin one — every upload then 404s and the UI reports an analysis error while `/health` looks healthy (twin's `/health` answers too). Check with `lsof -nP -iTCP:8000 -sTCP:LISTEN` before debugging the code.

## Architecture

One request is the whole system: `POST /api/analyze {code}` → `run_security_analysis()` in `backend/server.py`:

1. **A fresh Semgrep MCP server per request.** `mcp_servers.py` launches `semgrep mcp` (the MCP server built into the `semgrep` package, not the separate `semgrep-mcp`) over stdio, exposes only the `semgrep_scan` tool, with a 240 s session timeout. Because the subprocess exits after every request, its OpenTelemetry handler prints `RuntimeError: can't create new thread at interpreter shutdown` each time — harmless noise; the `200 OK` after it is the real result.
2. **The code is written to a temp `.py` file**, because `semgrep_scan` takes a path, and deleted in `finally`.
3. **The agent** (`gpt-4.1-mini`, `output_type=SecurityReport`) is driven by `SECURITY_RESEARCHER_INSTRUCTIONS` in `context.py`, which insists on exactly one `semgrep_scan` call with `config: "auto"` — the model otherwise invents rule-pack names and re-calls the tool. The summary must say "Semgrep found X issues, and I identified Y additional issues".
4. Issues are sorted by `cvss_score` descending, and `enhance_summary()` prefixes the character count.

**`SecurityReport` / `SecurityIssue` (pydantic, `server.py`) are a contract with `frontend/src/types/security.ts`** — change a field in one and change it in the other; `severity` is one of `critical|high|medium|low`.

**Frontend** is Next.js App Router, a single page (`src/app/page.tsx` + three components). `next.config.ts` has `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`. `API_BASE_URL` is `NEXT_PUBLIC_API_URL`, else `http://localhost:8000` only when `NODE_ENV=development` *and* the page is on `localhost`, else `''` — so the production bundle uses relative URLs and works on whatever domain serves it.

**Production is one container.** The Dockerfile is multi-stage: Node builds the static export, then a `python:3.12-slim` stage runs `uv sync --frozen`, installs semgrep, and copies `out/` to `static/`. `server.py` mounts `static/` at `/` only if it exists, and that mount must stay after the `/api/analyze` and `/health` routes or it swallows them. With `ENVIRONMENT=production` (set by both Terraform configs) CORS adds `*`, since the frontend is same-origin anyway.

**Terraform** (`terraform/azure`, `terraform/gcp`) uses the Docker provider to build (`platform = "linux/amd64"`) and push the image, then deploys Azure Container Apps (ACR + Log Analytics) or Cloud Run (Artifact Registry, public `run.invoker`). Keys are passed as `-var`s and set as plain container env vars. State is local and gitignored, along with `terraform.tfvars` and `*.auto.tfvars`.

## Traps already hit

- **Semgrep needs 2 GiB.** At 1 GiB the container SIGKILLs (-9) right after "Loading rules from registry..." — `list_tools` works, `semgrep_scan` dies. Both Terraform configs set cpu 1 / memory 2Gi; don't lower them.
- **`mcp==1.12.2` is pinned on purpose.** MCP 1.12.3 dropped FastMCP's `version` constructor argument, which the Semgrep MCP server still passed (`TypeError`). Re-test analysis before unpinning.
- **Terraform's Docker provider doesn't see source changes** — a code edit followed by `terraform apply` redeploys the old image. Use `terraform taint docker_image.app` (or bump `docker_image_tag`).
- **Apple Silicon builds arm64 by default**; Azure and Cloud Run need amd64, hence the `platform` setting (slower builds on M-series Macs).
- **Azure Container Apps' FQDN changes with each revision** (`--0000001`, `--0000002`…) — re-read `terraform output app_url` rather than reusing an old link. Apps scale to zero; logs via `az containerapp logs show`.
- "User doesn't have the Pro Engine installed" in the server log is a Semgrep upsell warning, not an error.
