# How the Cybersecurity Analyzer runs on Azure

This page explains what Docker, Terraform and the four Azure resources each do, and why the app needs all of them. Each piece gets a picture-book version first and then the real version.

---

## The story version: a lemonade stand

Imagine you made the world's best lemonade in your kitchen, and now you want strangers on the internet to be able to buy a glass.

| Thing | In the lemonade story | What it really is |
|---|---|---|
| **Docker** | A **sealed lunchbox** with the lemons, the sugar, the jug and the recipe inside. Open it anywhere and the lemonade tastes the same, because nothing depends on your kitchen. | A *container image*: the frontend, the Python backend, Semgrep and every library, packed into one file that runs the same on any computer. |
| **Container registry** (`cyberanalyzerncjra3`) | A **locker at the park** where you leave the lunchbox so the stand can pick it up. | Azure Container Registry (ACR). It stores the image you built on your Mac so Azure can download it. |
| **Container Apps Environment** (`cyber-analyzer-env`) | The **fenced-off area of the park** where stands are allowed, with electricity, water and a gate. | The shared network, security boundary and plumbing that Container Apps run inside. |
| **Container App** (`cyber-analyzer`) | The **lemonade stand** itself. It opens the lunchbox and serves customers, and it sleeps when nobody comes. | The running copy of your image, with a public HTTPS address. It scales to zero when idle, so it costs nothing. |
| **Log Analytics workspace** (`cyber-analyzer-logs`) | The stand's **diary**: who came, what they ordered, and whether something spilled. | Where everything the app prints (logs and errors) is collected so you can read it later. |
| **Resource group** (`cyber-analyzer-rg`) | The **toy box** all of the above goes into, so you can find it or throw it away together. | A folder for Azure resources, used for billing, permissions and cleanup. |
| **Terraform** | A **robot with a checklist**. You hand it the list, it builds everything in the right order, and it writes down what it built so it can tear it all down later. | Infrastructure as Code: `terraform/azure/main.tf` describes the resources, `terraform apply` creates them, and `terraform destroy` removes them. |

**Why you need every piece:** without the lunchbox (Docker) there is nothing portable to ship. Without the locker (registry), Azure can't reach the lunchbox on your Mac. Without the fenced area (environment), the stand has nowhere to stand. Without the stand (Container App), nobody can buy anything. Without the diary (logs), you can't tell why it broke. And without the robot (Terraform), you would click through the Azure Portal by hand every time and forget how to undo it.

---

## Architecture

```
  YOUR MAC
  ┌─────────────────────────────────────────────┐
  │ cyber/  (frontend/ + backend/ + Dockerfile) │
  │        │  terraform apply                   │
  │        ▼                                    │
  │ docker build --platform linux/amd64         │
  │        │  = one image (UI + API + Semgrep)  │
  └────────┼────────────────────────────────────┘
           │ push
           ▼
  AZURE  ·  resource group cyber-analyzer-rg  ·  Mexico Central
  ┌─────────────────────────────────────────────────────────────┐
  │  Container registry  cyberanalyzerncjra3   (stores image)   │
  │        │ pull                                               │
  │        ▼                                                    │
  │  ┌── Container Apps Environment  cyber-analyzer-env ──────┐ │
  │  │                                                        │ │
  │  │   Container App  cyber-analyzer                        │ │
  │  │   1 vCPU · 2 GiB · 0–1 replicas · port 8000            │ │
  │  │     FastAPI server.py                                  │ │
  │  │       /              → static Next.js UI               │ │
  │  │       /health        → "Cybersecurity Analyzer API"    │ │
  │  │       /api/analyze   → OpenAI agent + Semgrep          │ │
  │  │                                                        │ │
  │  └───────────────┬────────────────────────────┬───────────┘ │
  │                  │ logs                       │             │
  │                  ▼                            │             │
  │  Log Analytics  cyber-analyzer-logs           │             │
  └───────────────────────────────────────────────┼─────────────┘
           ▲                                      │ API keys (env vars)
           │ HTTPS                                ▼
  Visitor's browser                   OpenAI API (gpt-4.1-mini)
  https://cyber-analyzer.livelybay-    + Semgrep rule registry
  66a7cdf6.mexicocentral.
  azurecontainerapps.io
```

### What happens when someone clicks "Analyze"

1. The browser loads the page from the Container App. The UI is static files that FastAPI serves at `/`.
2. The page sends `POST /api/analyze` with the Python code to the **same address**, so there is no separate frontend server and no CORS problem.
3. `server.py` writes the code to a temporary `.py` file and starts a Semgrep MCP server for this one request.
4. An OpenAI Agents SDK agent (`gpt-4.1-mini`) calls `semgrep_scan` once, adds its own review, and returns a `SecurityReport`.
5. The issues come back sorted by CVSS score, and the UI draws the verdict banner, severity tiles and issue cards.
6. Everything the app prints goes to Log Analytics, where `az containerapp logs show` reads it.

If nobody visits for a while, the app scales to **0 replicas**. The next visitor waits a few seconds while it wakes up. That cold start is the price of not paying for idle time.

---

## What Docker does here

The `Dockerfile` is a two-step recipe, called a *multi-stage* build:

1. **Stage 1 (Node):** builds the Next.js frontend into plain HTML/JS/CSS files (`output: 'export'` makes it emit `out/`).
2. **Stage 2 (`python:3.12-slim`):** installs the backend with `uv sync --frozen`, installs Semgrep, and copies the frontend files into `static/`.

The result is **one image** that holds both the UI and the API, served from port 8000.

**Why `--platform linux/amd64`?** Your Mac has an Apple (ARM) chip, but Azure runs Intel/AMD-style (amd64) machines. Building for amd64 makes the lunchbox fit Azure's kitchen. The build is slower on an M-series Mac because it runs under emulation.

### Couldn't we skip Docker and deploy the code to Azure directly?

You could. There are two ways:

1. **Azure App Service in "code" mode.** You upload the Python code and Azure installs the packages on its own Python runtime. It would work for this app, but:
   - Semgrep needs about 2 GB of memory. The cheap B1 tier has only 1.75 GB, so you'd need B2 or higher at a fixed price of tens of dollars a month.
   - App Service plans **don't scale to zero**, so you pay while nobody visits. The Container App costs $0 while idle (only the roughly $5/month registry is fixed).
   - The Next.js UI has to be built and uploaded separately.
2. **Let Azure run Docker for you.** `az containerapp up --source .` uploads the folder and Azure builds the image in the cloud. You don't need Docker on your Mac, but an image is still made.

The course uses Docker because:
- **Same box everywhere.** Python 3.12, `uv`, Semgrep, the built UI and the backend are frozen into one image, so what you tested locally is exactly what runs on Azure. No "works on my Mac, broken in the cloud".
- **Portability.** Day 2 deploys the **same image** to Google Cloud Run without changing the app.
- **Scale to zero.** Container Apps and Cloud Run run images, and that's what lets the app sleep for free.

In lemonade terms: without Docker the park cooks your recipe in its own kitchen. It works, but you rent the kitchen all day and the taste may differ. With Docker you bring a sealed lunchbox that tastes the same everywhere, and the stand only opens when a customer shows up.

### Does Docker have to stay running in production?

**No.** Docker Desktop on your Mac is only needed **while building** the image:

```
build time  →  Docker Desktop on your Mac builds and pushes the image (a few minutes)
run time    →  Azure runs the container from the registry (Docker Desktop not involved)
```

After the push, your Mac can be off. Azure runs the container on its own runtime, wakes it when a visitor arrives, and puts it to sleep when idle.

---

## Automating it with GitLab CI

In a real team nobody builds on their laptop. When you push to `main`, a **GitLab runner** (a temporary build machine) builds the image, pushes it to ACR, and tells Azure to use it:

```
git push → GitLab runner: docker build → docker push to ACR → az containerapp update → new revision live
```

A minimal `.gitlab-ci.yml`, placed in the same folder as the `Dockerfile`. In this repo that's `cyber/`. A pipeline at the repo root needs `cd cyber` or `docker build ... cyber`.

```yaml
stages: [build, deploy]

build:
  stage: build
  image: docker:27
  services: [docker:27-dind]          # Docker inside the runner
  script:
    - docker login $ACR_SERVER -u $ACR_USER -p $ACR_PASSWORD
    - docker build --platform linux/amd64 -t $ACR_SERVER/cyber-analyzer:$CI_COMMIT_SHORT_SHA .
    - docker push $ACR_SERVER/cyber-analyzer:$CI_COMMIT_SHORT_SHA
  rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]

deploy:
  stage: deploy
  image: mcr.microsoft.com/azure-cli
  script:
    - az login --service-principal -u $AZ_CLIENT_ID -p $AZ_CLIENT_SECRET --tenant $AZ_TENANT_ID
    - az containerapp update -n cyber-analyzer -g cyber-analyzer-rg
        --image $ACR_SERVER/cyber-analyzer:$CI_COMMIT_SHORT_SHA
  rules: [{ if: '$CI_COMMIT_BRANCH == "main"' }]
```

The `$` values are **GitLab CI/CD variables** (Settings → CI/CD → Variables, marked *masked*): the ACR login, an Azure service principal, and the OpenAI and Semgrep keys. Never commit them to the repo.

**Three changes before switching to CI:**

1. **Split Terraform from the image build.** `main.tf` currently runs `docker build` itself (`terraform_data.image`), which only works on a machine with Docker. With CI, Terraform creates the infrastructure once and the pipeline handles images (`az containerapp update` above).
2. **Tag images with the commit SHA instead of `:latest`.** Every deploy is then traceable, a rollback means pointing the app at an older tag, and it fixes "Terraform doesn't see code changes".
3. **Move the Terraform state off your Mac.** Today it lives only in `terraform.tfstate.d/` on your laptop, so a runner wouldn't know what exists. Use an Azure Storage Account backend if CI will ever run `terraform`.

---

## What Terraform does here

`terraform apply` (from `cyber/terraform/azure/`) works through `main.tf` in this order:

| # | Resource in `main.tf` | What it does |
|---|---|---|
| 1 | `random_string.acr_suffix` | Makes up 6 random characters (`ncjra3`), because registry names must be unique across all of Azure. |
| 2 | `data.azurerm_resource_group.main` | **Looks up** the existing `cyber-analyzer-rg`. It doesn't create it, because you made it in Part 1. |
| 3 | `azurerm_container_registry.acr` | Creates the registry (Basic tier, admin login on so the app can pull from it). |
| 4 | `terraform_data.image` | Runs `docker build --platform linux/amd64 -t <registry>/cyber-analyzer:latest` on your Mac. |
| 5 | `docker_registry_image.app` | Pushes that image into the registry. |
| 6 | `azurerm_log_analytics_workspace.main` | Creates the log diary (30-day retention). |
| 7 | `azurerm_container_app_environment.main` | Creates the environment and wires it to the logs. |
| 8 | `azurerm_container_app.main` | Starts the app from the pushed image: 1 vCPU, 2 GiB (Semgrep gets killed with less), 0–1 replicas, public HTTPS on port 8000, and your API keys as environment variables. |
| 9 | `output "app_url"` | Prints the public link (`terraform output app_url`). |

Terraform keeps a record of what it built in `terraform.tfstate.d/azure/` (on your Mac and gitignored). That record is how `terraform destroy` knows exactly what to delete. **Don't delete that folder** while the app is still deployed.

---

## Two problems we hit, and why the files look the way they do

1. **`403 RequestDisallowedByAzure`:** an *Azure for Students* subscription only allows a few regions. This one allows `mexicocentral`, `belgiumcentral`, `spaincentral`, `denmarkeast` and `switzerlandnorth`, and `centralus` isn't on the list. The resources used to copy the resource group's region (`centralus`), so `main.tf` now uses `var.location` (default `mexicocentral` in `variables.tf`). Azure allows a resource to live in a different region from its resource group.
2. **`unpigz: invalid deflate data`:** the Terraform Docker provider's own build step sent a corrupted bundle of files to Docker Desktop 29, while the normal `docker build` command worked. Terraform therefore runs `docker build` itself (`terraform_data.image`) and the provider only pushes.

**To ship a code change:** run `terraform taint terraform_data.image` and then `terraform apply`. Terraform can't see that your source files changed, so the taint tells it to rebuild.

---

## Cost and cleanup

| Resource | Cost |
|---|---|
| Container registry (Basic) | about $5/month. This is the only thing that bills while idle. |
| Container App | pay per use, and $0 while scaled to zero |
| Log Analytics | first 5 GB/month free |

When you're done:

```bash
cd cyber/terraform/azure
terraform destroy -var="openai_api_key=$OPENAI_API_KEY" -var="semgrep_app_token=$SEMGREP_APP_TOKEN"
```

This removes all four resources. The empty resource group can stay, and it's free.
