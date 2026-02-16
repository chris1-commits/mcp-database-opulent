variable "resource_group_name" {}
variable "location" {}
variable "container_name" {}
variable "image" {}
variable "pg_host" {}
variable "pg_user" {}
variable "pg_password" {}
variable "pg_database" {}
variable "twilio_auth_token" {}
variable "whatsapp_app_secret" {}
variable "whatsapp_verify_token" { default = "" }
variable "notion_secret" {}
variable "n8n_url" {}
variable "elevenlabs_api_key" { default = "" }
variable "elevenlabs_voice_id" { default = "" }
variable "elevenlabs_model_id" { default = "" }
variable "openai_api_key" { default = "" }
variable "mcp_auth_token" { description = "MCP Server authentication token"; type = string; sensitive = true }
