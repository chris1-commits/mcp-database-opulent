variable "resource_group_name" {}
variable "location" {}
variable "container_name" {}
variable "image" {}
variable "pg_host" {}
variable "pg_user" {}
variable "pg_password" {}
variable "pg_database" {}
variable "cloudtalk_secret" {}
variable "notion_secret" {}
variable "n8n_url" {}
variable "elevenlabs_api_key" { default = "" }
variable "elevenlabs_voice_id" { default = "" }
variable "elevenlabs_model_id" { default = "" }
