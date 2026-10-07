<div align="center">

# 🚀 AI in Production — my build log

### Two Gen AI apps shipped all the way to a real URL: one as a Docker container on AWS Lambda, one as a Terraform-managed serverless stack.

[![MediNotes Pro](https://img.shields.io/badge/▶_Live-MediNotes_Pro-0e7c74?style=for-the-badge)](https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/)
[![Digital Twin](https://img.shields.io/badge/▶_Live-Digital_Twin-6C47FF?style=for-the-badge)](https://do2s1pa4farox.cloudfront.net)
[![AWS Lambda](https://img.shields.io/badge/Running_on-AWS_Lambda-FF9900?style=for-the-badge&logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Terraform](https://img.shields.io/badge/Infra-Terraform-7B42BC?style=for-the-badge&logo=terraform&logoColor=white)](twin/terraform/main.tf)

</div>

## ✨ The two projects at a glance

| | 🩺 [MediNotes Pro](saas/README.md) | 🤖 [Digital Twin](twin/README.md) |
|---|---|---|
| **Live** | [lambda-url…on.aws](https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/) | [do2s1pa4farox.cloudfront.net](https://do2s1pa4farox.cloudfront.net) |
| **What it does** | Turns a clinician's shorthand into a chart summary, next steps, red flags and a patient email | Answers questions about my background, in my voice, from my real LinkedIn and notes |
| **Frontend** | Next.js 16 Pages Router, static export, served by the API | Next.js 16 App Router, static export on S3 + CloudFront |
| **Backend** | FastAPI streaming SSE | FastAPI JSON API via Mangum |
| **Model** | OpenAI `gpt-5-nano` | AWS Bedrock, Amazon Nova |
| **Hosting** | One Docker image → ECR → Lambda Function URL + Web Adapter | Lambda zip + HTTP API Gateway + CloudFront |
| **Infra** | Docker + AWS CLI | **Terraform**, `dev` / `test` / `prod` workspaces, one-command deploy & destroy |
| **Data** | SQLite or DynamoDB (picked by one env var), every query scoped to the signed-in clinician | Conversations in S3, survive a page refresh |
| **Access control** | Clerk sign-in + paid-subscription gate | Usage limits: 3 messages per visitor per day, 50 site-wide, plus API throttling |
| **Write-up** | 📖 [`saas/README.md`](saas/README.md) | 📖 [`twin/README.md`](twin/README.md) |

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

### 🗺️ What's in this repo

| Folder | What it is |
|---|---|
| [`saas/`](saas/) | 🩺 **MediNotes Pro** — the full-stack app above (Next.js + FastAPI + Docker + Lambda) |
| [`twin/`](twin/) | 🤖 **Digital Twin** — AI chat persona (Next.js + FastAPI + Bedrock, deployed with Terraform) |
| [`instant/`](instant/) | ⚡ Production deploy in under 10 minutes — a single FastAPI file on Vercel |
| [`finale/`](finale/) | 🤖 Agents on AWS Bedrock AgentCore with Strands (tools, code interpreter, observability) |
| [`week1/`](week1/) – [`week4/`](week4/) | 📓 The day-by-day guides I worked through |
| [`guides/`](guides/) | 🧰 Setup and foundations notebooks |

<details>
<summary>💼 <b>The LinkedIn version of this post</b> (click to expand / copy)</summary>

<br/>

I just shipped an AI app the whole way to production — not a notebook, a URL. 🚀

**MediNotes Pro** turns a doctor's shorthand consultation notes into three finished pieces of work: a structured record summary, an actionable follow-up checklist, and a patient-friendly email draft. All three stream in live, token by token.

Try it 👉 https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/

What's under the hood:
🔹 Next.js 16 + React 19 + Tailwind v4, compiled to a static export
🔹 FastAPI streaming Server-Sent Events from OpenAI
🔹 One multi-stage Docker image serving frontend *and* API — no CORS, one URL, one bill
🔹 Pushed to Amazon ECR and run as an AWS Lambda container image, so it scales to zero
🔹 Clerk for auth, JWT verification and subscription gating — the token is checked before a single model token is spent

Three things that cost me an evening, in case they save you one:
1️⃣ Lambda buffers responses by default — streaming only works with the Lambda Web Adapter in `response_stream` mode
2️⃣ SSE strips newlines, so markdown arrives as one giant paragraph until you re-encode them
3️⃣ On Apple Silicon you must build `--platform linux/amd64 --provenance=false` or Lambda rejects the image

Biggest lesson: "it works locally" and "it works in production" are two different engineering problems, and the second one is where the learning is. 💡

⚠️ Demonstration project — not a medical device. Every output is a draft for a clinician to review and sign off.

#AI #AWS #Lambda #Serverless #NextJS #FastAPI #Docker #GenAI #MachineLearning #BuildInPublic

</details>

---

<br/>

# 📚 The course this repo is built from

## Deploy Gen AI and Agentic AI at Scale in 4 weeks

![Course Image](assets/course.png)

_If you're looking at this in Cursor, please right click on the filename in the Explorer on the left, and select "Open preview", to view it in formatted glory._

I could not be more excited to welcome you to my juiciest course yet!!

### Major links

- The [course itself on Udemy](https://edwarddonner.com/2025/05/28/connecting-my-courses-become-an-llm-expert-and-leader/)  - this has links to this course, and my companion courses on on LLM Engineering, Agentic AI, and LLMs for Leaders
- The [extra course resources](https://edwarddonner.com/2025/09/15/ai-in-production-gen-ai-and-agentic-ai-on-aws-at-scale/) on my website including the slides

### Before you begin

I'm here to help you be most successful! Please do reach out if I can help, either in the platform or by emailing me direct (ed@edwarddonner.com). It's always great to connect with people on LinkedIn to build up the community. If you post about your progress with the course, or share projects - then please tag me and I'll weigh in to amplify your achievements:    
https://www.linkedin.com/in/eddonner/  
I'm also trying out X at [@edwarddonner](https://x.com/edwarddonner) - if you're on X, please show me how it's done 😂  

### How this repo is organized

- Each week of the course gets its own folder; start in the week1 folder and pick day1.md
- There are many essential guides in the [guides](guides/01_intro.ipynb) section
- Please `git pull` frequently to get the latest updates - see [Guide 3 in the Guides folder](guides/03_git_and_github.ipynb) on how to pull.


### The deal you made

At the end of Day 1 in the course, I cunningly got you to agree to my terms!!

Repeat this to yourself through gritted teeth each time you're frustrated by an infrastructure roadblock..

1. I will embrace every roadblock with a positive attitude - this is where the learning happens!
2. I will be happy to roll up sleeves and dig in and do research and experiments myself and post on forums
3. I will use LLMs to help, but I recognize their blind-spots and will verify everything they suggest
4. I will post issues on Udemy, and Ed will try to help, but I understand that it’s not like code and if Ed can’t reproduce, then I’ll need to stick at it or move on
5. I’ll look for opportunities to help others in the community that are stuck

But do reach out and I'll try my very best..

### Making contributions

When you deploy projects, please make a new markdown file or python notebook in the community_contributions folder:
1. A short description of your project
2. A link to your repo
3. A link to you live, deployed project, if available
4. Anything about the experience that you'd like to share with other students

Then submit a PR so I can include it in the repo! See (Guide 3 in the Guides folder)[guides/03_git_and_github.ipynb] for more on submitting a PR.

### ABOVE ALL ELSE -

Be sure to have fun with the course! I have great stuff in store for you. There will definitely be some gnarly moments, but when you solve the issues, they will be very satisfying. And if not - [contact me](https://www.linkedin.com/in/eddonner/).