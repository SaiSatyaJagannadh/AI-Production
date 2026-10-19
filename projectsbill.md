# 💰 Projects bill: live links and monthly cost

All three apps are live. This page lists where each one runs, which cloud resources it uses, and roughly what it costs per month.

> **These are estimates, not a bill.** I worked them out from the resources defined in this repo (Terraform files, Dockerfiles, model names, usage limits) and public list prices, as of October 2026. To see the real numbers, use the commands in [How to check the real bill](#-how-to-check-the-real-bill) at the bottom.

## 🔗 Live links

| Project | Live link | Cloud | Region |
|---|---|---|---|
| 🩺 MediNotes Pro | https://55ncfzx5whditvl2364jsjk3gy0twvlw.lambda-url.us-east-2.on.aws/ | AWS | us-east-2 |
| 🤖 Digital Twin | https://do2s1pa4farox.cloudfront.net | AWS | us-east-2 (Bedrock in us-east-1) |
| 🛡️ Cyber Analyzer | https://cyber-analyzer.livelybay-66a7cdf6.mexicocentral.azurecontainerapps.io/ | Azure | mexicocentral |

## 📊 Monthly cost at a glance

| Project | When nobody uses it | With light demo traffic | What drives the cost |
|---|---|---|---|
| 🩺 MediNotes Pro | **≈ $0.05–0.10** | ≈ $0.10–1 | ECR image storage; OpenAI tokens per consultation |
| 🤖 Digital Twin | **≈ $0.01** | ≈ $0.10–0.70 (capped) | Bedrock tokens, capped at 50 messages a day |
| 🛡️ Cyber Analyzer | **≈ $5.00** | ≈ $5–6 | Azure Container Registry Basic, billed daily whether used or not |
| **Total** | **≈ $5.10/month** | **≈ $5–8/month** | |

Nearly all of the idle cost is the Azure container registry. Everything else scales to zero.

## 🩺 MediNotes Pro (AWS)

| Resource | Price | Estimate |
|---|---|---|
| Lambda `consultation-app` (container image, Function URL) | 1M requests + 400,000 GB-seconds free every month | $0 |
| ECR repo `consultation-app` (`:latest` image) | $0.10 per GB-month | ≈ $0.05–0.10 |
| DynamoDB (only if `DYNAMODB_TABLE` is set) or SQLite in `/tmp` | on-demand; 25 GB storage always free | ≈ $0 |
| CloudWatch Logs | 5 GB/month free | $0 |
| OpenAI `gpt-5-nano` | $0.05 / 1M input, $0.40 / 1M output tokens | ≈ $0.001 per consultation |
| Clerk (sign-in + subscription gate) | free tier | $0 |

About 100 consultations a month adds roughly $0.10 in OpenAI usage.

## 🤖 Digital Twin (AWS, Terraform `dev` workspace)

| Resource | Price | Estimate |
|---|---|---|
| Lambda `twin-dev-api` (zip, 60 s timeout) | inside the Lambda free tier | $0 |
| HTTP API Gateway (throttled 5 rps / burst 10) | $1.00 per million requests | ≈ $0 |
| CloudFront `do2s1pa4farox` | 1 TB + 10M requests free every month | $0 |
| S3: frontend bucket + memory bucket | $0.023 per GB-month | ≈ $0.01 |
| Bedrock `amazon.nova-micro-v1:0` | $0.035 / 1M input, $0.14 / 1M output tokens | ≈ $0.0004 per message |
| No custom domain (`use_custom_domain = false`) | no Route 53 or ACM charges | $0 |

**Hard cap:** the backend stops at 50 messages a day site-wide and 3 per visitor. Even if every message is used every day, about 1,500 messages a month × a ~10k-token persona prompt costs **under $1/month in Bedrock**.

⚠️ **Old stack still running:** CLAUDE.md lists a hand-built `twin-api` Lambda (CloudFront `d1ozrewa9otrmw`) from before the Terraform version. Terraform doesn't manage it, and `destroy.sh` won't remove it. It costs almost nothing while idle, but it's a second copy that can still be called. Delete it by hand if you no longer need it.

## 🛡️ Cyber Analyzer (Azure, Terraform `azure` workspace)

| Resource | Price | Estimate |
|---|---|---|
| Container Registry `cyberanalyzerncjra3` (Basic) | ≈ $0.167 per day | **≈ $5.00** (the only fixed cost) |
| Container App `cyber-analyzer` (1 vCPU, 2 GiB, 0–1 replicas) | free each month: 180,000 vCPU-seconds, 360,000 GiB-seconds, 2M requests | $0 under light use |
| Container Apps Environment `cyber-analyzer-env` | no charge on the Consumption plan | $0 |
| Log Analytics `cyber-analyzer-logs` | 5 GB/month free; `daily_quota_gb = 0.1` caps it at ≈ 3 GB | $0 |
| OpenAI `gpt-4.1-mini` | $0.40 / 1M input, $1.60 / 1M output tokens | ≈ $0.01–0.02 per scan |
| Semgrep app token | free | $0 |

**How far the free grant goes:** after a scan, the replica stays up for a few minutes before scaling back to zero, so each visit uses about 5 minutes of 1 vCPU. That makes roughly **500 visits a month free**. After that it's about $0.01 per extra visit.

**Azure for Students:** these charges come out of your student credit, not a card. Check how much credit is left in the Azure portal under *Cost Management*.

## 🧾 How to check the real bill

AWS, cost for this month by service:

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date -d tomorrow +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

(On macOS, replace `date -d tomorrow +%Y-%m-%d` with `date -v+1d +%Y-%m-%d`.) Cost Explorer must be enabled once in the Billing console first.

Azure, cost for this month for the resource group:

```bash
az consumption usage list \
  --start-date $(date +%Y-%m-01) --end-date $(date +%Y-%m-%d) \
  --query "[?contains(instanceId,'cyber-analyzer-rg')].{name:instanceName, cost:pretaxCost}" -o table
```

Or open **Cost Management → Cost analysis** in the portal and filter to `cyber-analyzer-rg`.

OpenAI usage for both MediNotes and Cyber is at https://platform.openai.com/usage.

## 🔄 Cheaper alternatives (keep the apps live, pay less)

Ordered by how much each saves.

| # | Alternative | Saves | Trade-off |
|---|---|---|---|
| 1 | **Host the Cyber image on GitHub Container Registry (ghcr.io) instead of Azure Container Registry.** A public image on ghcr.io is free, and Container Apps can pull it without credentials. Push with `docker push ghcr.io/saisatyajagannadh/cyber-analyzer:latest`, point the Container App's `image` at it, and drop the `azurerm_container_registry` resource from `main.tf`. | **≈ $5/month**, the whole idle bill | The image becomes public. That's fine here: API keys are runtime env vars, not baked into the image, and the code is already in this repo. Docker Hub's free public repos work the same way. |
| 2 | **Move Cyber to Google Cloud Run.** The `cyber/terraform/gcp` workspace is already written. Cloud Run's free grant is the same as Container Apps' (180k vCPU-seconds, 360k GiB-seconds, 2M requests), and Artifact Registry gives 0.5 GB free, then $0.10/GB-month. | ≈ $4.90/month | The image is likely over 0.5 GB because of Semgrep, so expect a few cents a month. It also means a new link and a new cloud account to look after. |
| 3 | **Deploy Cyber only when you're showing it.** `terraform destroy` after a demo, `terraform apply` before the next one (about 5–10 minutes). | ≈ $5/month while it's down | The link is dead in between, and the URL may change after each apply. |
| 4 | **Use a cheaper model for Cyber:** `gpt-5-nano` ($0.05 / $0.40 per 1M tokens) or `gpt-4.1-nano` ($0.10 / $0.40) instead of `gpt-4.1-mini` ($0.40 / $1.60). It's one line in `cyber/backend/server.py`. | 4–8× less per scan | The agent may find fewer extra issues beyond Semgrep's. Run it on `airline.py` before and after to compare. |
| 5 | **Add an ECR lifecycle policy for MediNotes.** Each push of `:latest` leaves the previous image behind untagged, and every one of them is billed. A rule like "expire untagged images after 1 day" keeps only the live one. | a few cents a month, growing with every deploy | None |
| 6 | **Delete the old hand-built `twin-api` stack** (CloudFront `d1ozrewa9otrmw`). | cents, plus one less public endpoint | None. The Terraform `twin-dev-api` stack is the live one. |

**With #1 (or #2) and #5, the whole portfolio drops from ≈ $5.10 to ≈ $0.10 per month while idle, and all three links stay live.**

ECR lifecycle rule for #5:

```bash
aws ecr put-lifecycle-policy --repository-name consultation-app --region us-east-2 \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"expire untagged","selection":{"tagStatus":"untagged","countType":"sinceImagePushed","countUnit":"days","countNumber":1},"action":{"type":"expire"}}]}'
```

## ✂️ How to cut the bill to ≈ $0

- **Cyber Analyzer:** `cd cyber/terraform/azure && terraform destroy -var="openai_api_key=$OPENAI_API_KEY" -var="semgrep_app_token=$SEMGREP_APP_TOKEN"` removes the registry and the $5/month with it. Run `terraform apply` again to bring it back.
- **Digital Twin:** `cd twin && ./scripts/destroy.sh dev`, then delete the hand-built `twin-api` stack by hand.
- **MediNotes Pro:** costs cents while idle. To remove it completely, delete the `consultation-app` Lambda and its ECR repo.
- **Billing alarm:** set a $10/month AWS Budget and an Azure budget alert, so a surprise shows up in your email rather than on your statement.
