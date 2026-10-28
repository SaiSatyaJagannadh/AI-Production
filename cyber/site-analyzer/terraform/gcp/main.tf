terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_client_config" "default" {}

provider "docker" {
  registry_auth {
    address  = "${var.region}-docker.pkg.dev"
    username = "oauth2accesstoken"
    password = data.google_client_config.default.access_token
  }
}

resource "google_project_service" "cloudrun" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = var.service_name
  format        = "DOCKER"
  description   = "Images for ${var.service_name}"

  depends_on = [google_project_service.artifactregistry]
}

locals {
  src = "${path.module}/../.."
  # The tag is a hash of the source, so editing the app and running apply rebuilds and redeploys -
  # no `terraform taint` needed (the trap the cyber stack has).
  src_hash = substr(sha1(join("", [
    for f in sort(flatten([for p in ["Dockerfile", "pyproject.toml", "uv.lock", "app/*.py", "app/*.yml", "app/static/**"] : tolist(fileset(local.src, p))])) :
    filesha1("${local.src}/${f}")
  ])), 0, 12)
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/${var.service_name}:${local.src_hash}"
}

# Built with the docker CLI: the provider's own build block breaks on Docker Desktop 29
# ("unpigz: invalid deflate data") and resolves the Dockerfile path from the wrong directory.
resource "terraform_data" "image" {
  input            = local.image
  triggers_replace = local.image # input alone updates in place and would skip the build

  provisioner "local-exec" {
    command = "docker build --platform linux/amd64 -t ${self.input} ${local.src}"
  }

  depends_on = [google_artifact_registry_repository.app]
}

resource "docker_registry_image" "app" {
  name = terraform_data.image.output

  lifecycle {
    replace_triggered_by = [terraform_data.image]
  }
}

resource "google_cloud_run_service" "app" {
  name     = var.service_name
  location = var.region

  template {
    spec {
      timeout_seconds = 300

      containers {
        image = docker_registry_image.app.name

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi" # the custom Semgrep rules peak well under 1 GiB (cyber's registry rules need 2)
          }
        }

        env {
          name  = "OPENAI_API_KEY"
          value = var.openai_api_key
        }

        env {
          name  = "ANALYSES_PER_VISITOR_PER_HOUR"
          value = tostring(var.analyses_per_visitor_per_hour)
        }

        env {
          name  = "ANALYSES_PER_DAY"
          value = tostring(var.analyses_per_day)
        }

        ports {
          container_port = 8000
        }
      }
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "0"
        "autoscaling.knative.dev/maxScale" = "1" # one instance keeps the in-memory rate limit exact
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  depends_on = [google_project_service.cloudrun]
}

resource "google_cloud_run_service_iam_member" "public" {
  service  = google_cloud_run_service.app.name
  location = google_cloud_run_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value       = google_cloud_run_service.app.status[0].url
  description = "Public URL of Cyber Site Analyzer"
}
