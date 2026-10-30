# 🔎 Cyber Site Analyzer

**Live 👉 https://cyber-site-analyzer-549044732956.us-central1.run.app**

**Is this website legit?** Paste a shop, a link from an ad, or any site you're unsure about, and get a
0–100 trust score with the evidence behind it. It sits beside the week 3 Cybersecurity Analyzer
(`cyber/`), which it doesn't touch: that one reviews Python code, and this one reviews live websites.

## What it checks

| Check | Source | What it catches |
|---|---|---|
| Domain age, registrar, owner | RDAP, asked of the domain's own registry (IANA bootstrap) | Fake shops are usually weeks old |
| Popularity | Tranco research ranking (top 1M sites) | Real businesses are ranked; scams almost never are |
| Blocklists | Cloudflare Security DNS + OpenPhish feed | Known malware and phishing domains |
| Lookalike brands | built-in list of the ~80 most-impersonated brands | `paypal-login.com`, `amaz0n.com`, `nike-outlet.shop`: homoglyphs, typos, added words |
| SSL certificate | direct TLS handshake | Invalid, self-signed or expiring certs; OV/EV organisation |
| Live page | the page itself, following redirects | Redirect chains, missing HTTPS/HSTS/CSP, forms posting to other domains |
| Store checks | links and badges on the homepage | No returns/contact/privacy pages; which protected payment methods it shows |
| Hosting | ipinfo | Hosting company, ASN and country |
| Scam-pattern scan | **Semgrep**, custom rules in [`app/rules.yml`](app/rules.yml) | Obfuscated `eval(atob(...))`, card-skimmer beacons, crypto/gift-card/wire-only payment, hidden iframes, 90%-off "closing down" pressure, right-click blocking |
| Reddit | PullPush archive + AI web search | Top comments about the domain; buyer experiences ranked above mere mentions, referral spam dropped |
| Reviews & scam reports | OpenAI Agents SDK + web search | Trustpilot, scam-report sites, news, each one cited |

## How it compares with ScamAdviser and URLVoid

Those tools give a score from reputation data: age, hosting, popularity, blocklists. Every reputation
tool shares one weakness: **a brand-new scam isn't on any list until someone reports it.** This app
covers that gap three ways:

1. **It reads the site's own code.** Semgrep scans the homepage and its scripts for skimmers and
   scam-payment tricks, so the evidence comes from the site itself, not from reports about it.
2. **It catches impersonators on day one.** Lookalike detection and domain age need no reports.
3. **The AI is fenced in by hard rules.** The model weighs everything into a score, then deterministic
   guardrails override it:

   | Rule | Score is at most |
   |---|---|
   | Listed on a blocklist | 15 |
   | Impersonates a known brand | 25 |
   | Domain under 30 days old | 35 |
   | Invalid TLS, or Semgrep finds skimmer/obfuscated code | 40 |
   | Domain under 6 months old | 60 |
   | *Floor:* ranked in the global top 10,000, with clean blocklists and no lookalike flag | at least 65 |

   For example, on `paypal-login.com` the AI alone said **65 ("likely safe")**. The lookalike rule
   capped it at **25 ("high risk")**, and the report explains why. The verdict comes from score bands
   (85+ trusted, 65+ likely safe, 40+ caution, below that high risk), so the badge, gauge and text
   always agree.

Every report also shows Reddit comments, cited sources, a shareable link (`?site=example.com`) and a
"Save as PDF" print layout.

## Run it locally

`.env` in `cyber/` (one level up) needs `OPENAI_API_KEY`. `load_dotenv()` finds it from here.

```bash
uv tool install semgrep              # kept outside the app venv: its pins clash with current FastAPI
cd site-analyzer/app
PORT=8001 uv run python server.py    # http://localhost:8001 - 8000 is taken by cyber/twin/saas
uv run python test_checks.py         # offline self-check, asserts only - every Semgrep rule, lookalikes, guardrails
```

## Deploy (Google Cloud Run)

```bash
set -a; source ../.env; set +a              # from site-analyzer/
cd terraform/gcp && terraform init && terraform workspace new gcp
terraform apply -var="project_id=<your-project-id>" -var="openai_api_key=$OPENAI_API_KEY"
terraform output service_url
```

The image tag is a hash of the source, so **editing the app and re-running `apply` rebuilds and
redeploys it**. No `terraform taint`. The image is built with the docker CLI, because the Docker
provider's own build breaks on Docker Desktop 29. `terraform_data` needs `triggers_replace` for this,
because a changed `input` alone updates in place and skips the build.

## Cost and abuse limits

Cloud Run scales to zero (1 vCPU, 1 GiB, max 1 instance), so the app costs nothing while idle. The
public URL spends your OpenAI credit, so `/api/analyze` is capped at **10 checks per visitor per hour
and 200 per day** overall (`analyses_per_visitor_per_hour` / `analyses_per_day`). The counters live in
memory, which is exact at one instance.

## Safety

The server fetches whatever URL a visitor types, so every request, redirects included, must resolve
to a public IP on port 80 or 443. That blocks `localhost`, private networks and the cloud metadata
server (`169.254.169.254`). Page titles and Reddit text are passed to the model as data, never
instructions, and the UI escapes everything it renders.

A high score is not a guarantee. Marketplaces can be legitimate while individual sellers on them are not.
