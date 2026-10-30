<div align="center">

# 🚀 AI in Production — my build log

### Four Gen AI apps running in production on three clouds: a Docker container on AWS Lambda, a Terraform-managed serverless stack on AWS, an AI security agent on Azure Container Apps, and an AI website trust checker on Google Cloud Run.

[![MediNotes Pro](https://img.shields.io/badge/▶_Live-MediNotes_Pro-0e7c74?style=for-the-badge)](https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/)
[![Digital Twin](https://img.shields.io/badge/▶_Live-Digital_Twin-6C47FF?style=for-the-badge)](https://do2s1pa4farox.cloudfront.net)
[![AWS Lambda](https://img.shields.io/badge/Running_on-AWS_Lambda-FF9900?style=for-the-badge&logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Cyber Analyzer](https://img.shields.io/badge/▶_Live-Cyber_Analyzer-C62828?style=for-the-badge)](https://cyber-analyzer.livelybay-66a7cdf6.mexicocentral.azurecontainerapps.io/)
[![Azure](https://img.shields.io/badge/Running_on-Azure_Container_Apps-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white)](cyber/AZURE_EXPLAINED.md)
[![Cyber Site Analyzer](https://img.shields.io/badge/▶_Live-Cyber_Site_Analyzer-0891B2?style=for-the-badge)](https://cyber-site-analyzer-549044732956.us-central1.run.app)
[![Google Cloud Run](https://img.shields.io/badge/Running_on-Google_Cloud_Run-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white)](cyber/site-analyzer/README.md)
[![Terraform](https://img.shields.io/badge/Infra-Terraform-7B42BC?style=for-the-badge&logo=terraform&logoColor=white)](twin/terraform/main.tf)

</div>

## ✨ The four projects at a glance

| | 🩺 [MediNotes Pro](saas/README.md) | 🤖 [Digital Twin](twin/README.md) | 🛡️ [Cyber Analyzer](cyber/AZURE_EXPLAINED.md) | 🔎 [Cyber Site Analyzer](cyber/site-analyzer/README.md) |
|---|---|---|---|---|
| **Live** | [lambda-url…on.aws](https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/) | [do2s1pa4farox.cloudfront.net](https://do2s1pa4farox.cloudfront.net) | [cyber-analyzer…azurecontainerapps.io](https://cyber-analyzer.livelybay-66a7cdf6.mexicocentral.azurecontainerapps.io/) | [cyber-site-analyzer…run.app](https://cyber-site-analyzer-549044732956.us-central1.run.app) |
| **What it does** | Turns a clinician's shorthand into a chart summary, next steps, red flags and a patient email | Answers questions about my background, in my voice, from my real LinkedIn and notes | Scans uploaded Python for vulnerabilities and returns fixes ranked by CVSS score | Tells you if a website is legit: a 0–100 trust score from domain age, blocklists, lookalike detection, a Semgrep scan of the site's own code, Reddit comments and cited web reviews |
| **Frontend** | Next.js 16 Pages Router, static export, served by the API | Next.js 16 App Router, static export on S3 + CloudFront | Next.js 15 App Router, static export, served by the API | One static HTML page with no build step, served by the API |
| **Backend** | FastAPI streaming SSE | FastAPI JSON API via Mangum | FastAPI + OpenAI Agents SDK, Semgrep as an MCP tool | FastAPI + OpenAI Agents SDK with web search; Semgrep CLI with custom scam/skimmer rules |
| **Model** | OpenAI `gpt-5-nano` | AWS Bedrock, Amazon Nova | OpenAI `gpt-4.1-mini`, structured output | OpenAI `gpt-4.1-mini`, structured output, then hard guardrail rules |
| **Hosting** | One Docker image → ECR → Lambda Function URL + Web Adapter | Lambda zip + HTTP API Gateway + CloudFront | One Docker image → Azure Container Registry → Azure Container Apps, scales to zero | One Docker image → Artifact Registry → Google Cloud Run, scales to zero |
| **Infra** | Docker + AWS CLI | **Terraform**, `dev` / `test` / `prod` workspaces, one-command deploy & destroy | **Terraform** `azure` workspace builds, pushes and deploys; `gcp` workspace also live on Cloud Run | **Terraform** `gcp` workspace; the image tag is a source hash, so `apply` redeploys on any code change |
| **Data** | SQLite or DynamoDB (picked by one env var), every query scoped to the signed-in clinician | Conversations in S3, survive a page refresh | Stateless: code goes to a temp file for Semgrep and is deleted after the scan | Stateless: evidence is gathered live from 9 sources per request |
| **Access control** | Clerk sign-in + paid-subscription gate | Usage limits: 3 messages per visitor per day, 50 site-wide, plus API throttling | No sign-in; OpenAI and Semgrep keys stay server-side | No sign-in; 10 checks per visitor per hour, 200 a day; SSRF guard blocks private and metadata IPs |
| **Write-up** | 📖 [`saas/README.md`](saas/README.md) | 📖 [`twin/README.md`](twin/README.md) | 📖 [`cyber/AZURE_EXPLAINED.md`](cyber/AZURE_EXPLAINED.md) | 📖 [`cyber/site-analyzer/README.md`](cyber/site-analyzer/README.md) |

## 🩺 Project 1 — MediNotes Pro

**Live 👉 https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/**

A clinician pastes the shorthand they typed during a consultation. Twenty seconds later they have three finished drafts, streamed in live and each with its own copy button:

| | |
|---|---|
| 📋 **Summary of visit** | a structured entry for the patient record |
| ✅ **Next steps** | follow-ups, labs and medication changes as a checklist |
| ✉️ **Patient email** | the same visit, in language a patient actually reads |

One Docker image serves **both** the static Next.js frontend and the streaming FastAPI backend, behind a single AWS Lambda Function URL — so it scales to zero and costs per consultation, not per hour.

```
Next.js 16 static export  →  FastAPI + SSE  →  Lambda Web Adapter (response_stream)
        Clerk JWT + subscription gating  ·  OpenAI gpt-5-nano  ·  ECR container image
```

📖 **Architecture diagrams, the deploy pipeline and the three bugs that cost me an evening: [`saas/README.md`](saas/README.md)**

## 🤖 Project 2 — Digital Twin

**Live 👉 https://do2s1pa4farox.cloudfront.net**

Recruiters can chat with an AI version of me. It answers from my real LinkedIn profile, summary, writing style and facts, which are assembled into the prompt at startup, and it remembers the conversation across page refreshes.

The point of this one is the infrastructure. The whole stack (S3 buckets, CloudFront, API Gateway with throttling, Lambda, the IAM role and an optional custom domain with ACM + Route 53) is **Terraform**, so `./scripts/deploy.sh dev` builds it from nothing and `./scripts/destroy.sh dev` removes it. Because it's a public link, it has guardrails: each visitor gets 3 messages a day with a live countdown in the UI, and the whole site is capped at 50 a day, so the Bedrock bill can't run away.

```
Next.js 16 static export on S3 + CloudFront  →  API Gateway (throttled)  →  Lambda (FastAPI + Mangum)
        AWS Bedrock Amazon Nova  ·  S3 conversation memory  ·  Terraform workspaces dev / test / prod
```

📖 **Architecture, what I built on top of the course and the production-only bugs: [`twin/README.md`](twin/README.md)**

## 🛡️ Project 3 — Cybersecurity Analyzer

**Live 👉 https://cyber-analyzer.livelybay-66a7cdf6.mexicocentral.azurecontainerapps.io/**

You upload or paste Python code, and an AI security agent reviews it in about 30 seconds. It runs **Semgrep** static analysis through an **MCP server**, does its own review on top, and returns each issue with the vulnerable snippet, an explanation, a fix, a severity and a **CVSS score**. The worst issues come first.

What I built and shipped:
- **The agent loop.** FastAPI starts a fresh Semgrep MCP server for each request. An OpenAI Agents SDK agent calls `semgrep_scan` exactly once and returns a typed `SecurityReport`. On the vulnerable sample [`cyber/airline.py`](cyber/airline.py), Semgrep found 4 issues and the agent found 1 more: an `eval()` call, plus SQL injection in four places.
- **A results dashboard.** Drag-and-drop, paste or "Try a sample" input with inline validation. Results show a verdict banner, severity tiles that work as filters, a distribution bar and collapsible issue cards. The UI derives each severity from the CVSS score using the standard bands (9+ critical, 7+ high, 4+ medium) and ignores the model's own label, because the model regularly calls a 9.0 "high".
- **One container.** A multi-stage Docker build bakes the Next.js static export into the FastAPI image, so a single port serves both the UI and the API.
- **Deployed to Azure Container Apps with Terraform.** One `terraform apply` builds the image for amd64, pushes it to Azure Container Registry, and starts the app with 1 vCPU and 2 GiB (Semgrep gets killed with less). It also sets up a Log Analytics workspace. The app scales to zero, so the only idle cost is the Basic registry (about $5/month), and a 0.1 GB/day log cap keeps logging inside the free tier. The same app is also live on Google Cloud Run from the `gcp` workspace: https://cyber-analyzer-t7r47ckxwq-uc.a.run.app

Two production problems I solved along the way: the *Azure for Students* subscription blocks most regions (hence `mexicocentral`), and Terraform's Docker provider sent a corrupted build context to Docker Desktop 29, so Terraform now runs `docker build` itself and the provider only pushes.

```
Next.js 15 static export  →  FastAPI /api/analyze  →  OpenAI Agents SDK (gpt-4.1-mini)
        Semgrep MCP server (semgrep_scan)  ·  Docker → ACR  ·  Terraform → Azure Container Apps (scale to zero)
```

📖 **How it runs on Azure (Docker, Terraform, every resource, cost and cleanup): [`cyber/AZURE_EXPLAINED.md`](cyber/AZURE_EXPLAINED.md)** · 📓 Course guides: [`cyber/week3/`](cyber/week3/)

## 🔎 Project 4 — Cyber Site Analyzer

**Live 👉 https://cyber-site-analyzer-549044732956.us-central1.run.app**

Paste a shop, a link from an ad, or any website you're unsure about. About 20 seconds later you get a **0–100 trust score** with the evidence behind it. I built it after looking at what ScamAdviser and URLVoid do. They score sites from reputation data, so **a brand-new scam slips through until someone reports it**. This one also collects evidence that needs no reports:

| | |
|---|---|
| 🗓️ **Domain & popularity** | domain age, registrar and owner straight from the registry (RDAP), plus its Tranco global rank |
| 🚫 **Blocklists & lookalikes** | Cloudflare Security DNS and OpenPhish, and detection of fake brand domains like `paypal-login.com` or `amaz0n.com` |
| 🧬 **Semgrep on the site's own code** | custom rules scan the homepage and its scripts for card skimmers, `eval(atob(...))` obfuscation, crypto/gift-card-only payment and fake "90% off" pressure |
| 💬 **Reddit & the web** | the top Reddit comments about the domain, and an AI agent that searches reviews and scam reports and cites every source |
| 🏪 **Store checks** | returns, contact and privacy pages, which protected payment methods it offers, SSL, redirects, security headers and hosting |

What makes it trustworthy is that **the AI doesn't get the last word**. Deterministic guardrails cap the score: blocklisted ≤ 15, impersonating a brand ≤ 25, domain under 30 days ≤ 35, skimmer code ≤ 40. A top-10,000 site with clean blocklists can't drop below 65. On `paypal-login.com` the model alone said 65 ("likely safe"); the lookalike rule capped it at 25 ("high risk"), and the report says why.

Production details: every fetch, redirects included, is checked against private and cloud-metadata IPs (an SSRF guard). Per-visitor and daily limits protect the OpenAI bill. The Docker image tag is a hash of the source, so `terraform apply` redeploys whenever the code changes. And an offline self-check exercises every Semgrep rule, the lookalike matcher and the guardrails.

```
Static HTML dashboard  →  FastAPI /api/analyze  →  9 evidence sources in parallel  →  OpenAI Agents SDK + web search
        Semgrep custom rules  ·  hard guardrail caps  ·  Docker → Artifact Registry  ·  Terraform → Google Cloud Run
```

📖 **Every check, the guardrail table and how it compares: [`cyber/site-analyzer/README.md`](cyber/site-analyzer/README.md)**

### 🗺️ What's in this repo

| Folder | What it is |
|---|---|
| [`saas/`](saas/) | 🩺 **MediNotes Pro** — the full-stack app above (Next.js + FastAPI + Docker + Lambda) |
| [`twin/`](twin/) | 🤖 **Digital Twin** — AI chat persona (Next.js + FastAPI + Bedrock, deployed with Terraform) |
| [`cyber/`](cyber/) | 🛡️ **Cybersecurity Analyzer** — Semgrep MCP + AI agent code scanner (Docker + Terraform, live on Azure Container Apps) |
| [`cyber/site-analyzer/`](cyber/site-analyzer/) | 🔎 **Cyber Site Analyzer** — is this website legit? Trust score from 9 evidence sources + Semgrep + AI (live on Google Cloud Run) |
| [`instant/`](instant/) | ⚡ Production deploy in under 10 minutes — a single FastAPI file on Vercel |
| [`finale/`](finale/) | 🤖 Agents on AWS Bedrock AgentCore with Strands (tools, code interpreter, observability) |
| [`week1/`](week1/) – [`week4/`](week4/) | 📓 The day-by-day guides I worked through |
| [`guides/`](guides/) | 🧰 Setup and foundations notebooks |

<details>
<summary>💼 <b>The LinkedIn version of this post</b> (click to expand / copy)</summary>

<br/>

I just shipped four AI apps to production. Not notebooks: four live URLs on three clouds (AWS, Azure, Google Cloud). 🚀

🩺 **MediNotes Pro** turns a doctor's shorthand into a record summary, a follow-up checklist, red flags and a patient email, streamed in live.
👉 https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/
🔹 One Docker image serving the Next.js frontend *and* a streaming FastAPI backend on AWS Lambda, so it scales to zero
🔹 Clerk sign-in and subscription gating, checked before a single model token is spent

🤖 **Digital Twin** is an AI version of me that answers recruiters from my real LinkedIn profile and notes.
👉 https://do2s1pa4farox.cloudfront.net
🔹 The whole stack (S3, CloudFront, API Gateway, Lambda, IAM) is Terraform: one command to deploy, one to destroy
🔹 AWS Bedrock (Amazon Nova), with per-visitor and site-wide daily limits so a public link can't run up the bill

🛡️ **Cybersecurity Analyzer** scans Python code for vulnerabilities and ranks the fixes by CVSS score.
👉 https://cyber-analyzer.livelybay-66a7cdf6.mexicocentral.azurecontainerapps.io/
🔹 An OpenAI Agents SDK agent that runs Semgrep through an MCP server, then adds its own review
🔹 Terraform builds the container, pushes it to Azure Container Registry and deploys it to Azure Container Apps, which scales to zero when idle

🔎 **Cyber Site Analyzer** tells you whether a website is legit before you buy from it.
👉 https://cyber-site-analyzer-549044732956.us-central1.run.app
🔹 Domain age, blocklists, fake-brand detection, a Semgrep scan of the site's own code, top Reddit comments and AI-researched reviews with sources
🔹 Hard guardrails the AI can't override: it scored a PayPal lookalike "likely safe", and the rules capped it at "high risk"

Things that cost me an evening, in case they save you one:
1️⃣ Lambda buffers responses by default. Streaming only works with the Lambda Web Adapter in `response_stream` mode
2️⃣ On Apple Silicon, build with `--platform linux/amd64`, or Lambda and Azure reject the image
3️⃣ Semgrep gets killed at 1 GiB of memory, so the container needs 2 GiB
4️⃣ Lambda's Linux filesystem is case-sensitive, so `Linkedin.pdf` ≠ `linkedin.pdf`, and the twin quietly lost its profile

Biggest lesson: "it works locally" and "it works in production" are two different engineering problems, and the second one is where the learning is. 💡

⚠️ MediNotes Pro is a demonstration project, not a medical device. Every output is a draft for a clinician to review.

#AI #AWS #Azure #GoogleCloud #Terraform #Serverless #NextJS #FastAPI #Docker #MCP #GenAI #BuildInPublic

</details>

---

<sub>Built while working through Ed Donner's course <a href="https://edwarddonner.com/2025/09/15/ai-in-production-gen-ai-and-agentic-ai-on-aws-at-scale/">AI in Production: Gen AI and Agentic AI on AWS at Scale</a>.</sub>
