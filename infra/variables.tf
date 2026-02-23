variable "resource_group_name" {
  description = "Azure Resource Group name"
  type        = string
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
}

variable "container_name" {
  description = "Name for the container group and DNS label"
  type        = string
}

variable "image" {
  description = "Docker image for the MCP Gateway container"
  type        = string
}

variable "pg_host" {
  description = "PostgreSQL server hostname"
  type        = string
}

variable "pg_user" {
  description = "PostgreSQL admin username"
  type        = string
}

variable "pg_password" {
  description = "PostgreSQL admin password"
  type        = string
  sensitive   = true
}

variable "pg_database" {
  description = "PostgreSQL database name"
  type        = string
}

variable "twilio_auth_token" {
  description = "Twilio Auth Token for webhook signature verification"
  type        = string
  sensitive   = true
}

variable "whatsapp_app_secret" {
  description = "WhatsApp / Meta App Secret for signature verification"
  type        = string
  sensitive   = true
}

variable "whatsapp_verify_token" {
  description = "WhatsApp webhook verification token"
  type        = string
  default     = ""
}

variable "notion_secret" {
  description = "Notion webhook secret"
  type        = string
  sensitive   = true
}

variable "n8n_url" {
  description = "N8N / workflow engine webhook URL"
  type        = string
}

variable "elevenlabs_api_key" {
  description = "ElevenLabs API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "elevenlabs_voice_id" {
  description = "ElevenLabs voice ID"
  type        = string
  default     = ""
}

variable "elevenlabs_model_id" {
  description = "ElevenLabs model ID"
  type        = string
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "mcp_auth_token" {
  description = "MCP Server authentication token"
  type        = string
  sensitive   = true
}
