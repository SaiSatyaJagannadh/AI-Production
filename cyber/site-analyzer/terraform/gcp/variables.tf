variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service and Artifact Registry repository name"
  type        = string
  default     = "cyber-site-analyzer"
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "analyses_per_visitor_per_hour" {
  description = "Checks one visitor may run per hour"
  type        = number
  default     = 10
}

variable "analyses_per_day" {
  description = "Checks the whole site may run per day - the cap on OpenAI spend"
  type        = number
  default     = 200
}
