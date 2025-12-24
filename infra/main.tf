provider "azurerm" {
  features {}
}

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

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_container_group" "mcp_gateway" {
  name                = var.container_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Linux"

  container {
    name   = "gateway"
    image  = var.image
    cpu    = "1"
    memory = "2"

    ports {
      port     = 8000
      protocol = "TCP"
    }

    environment_variables = {
      PGHOST                   = var.pg_host
      PGPORT                   = "5432"
      PGUSER                   = var.pg_user
      PGPASSWORD               = var.pg_password
      PGDATABASE               = var.pg_database
      CLOUDTALK_WEBHOOK_SECRET = var.cloudtalk_secret
      NOTION_WEBHOOK_SECRET    = var.notion_secret
      N8N_WEBHOOK_URL          = var.n8n_url
      ELEVENLABS_API_KEY       = var.elevenlabs_api_key
      ELEVENLABS_VOICE_ID      = var.elevenlabs_voice_id
      ELEVENLABS_MODEL_ID      = var.elevenlabs_model_id
      OPENAI_API_KEY           = var.openai_api_key
      MCP_AUTH_TOKEN           = var.mcp_auth_token
    }
  }

  ip_address_type = "Public"
  dns_name_label  = var.container_name
}
