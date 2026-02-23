// ---------------------------------------------------------------------------
// MCP Database Opulent – Azure Infrastructure
//
// Resources:
//   - Resource Group
//   - Azure Key Vault (centralised secret store with RBAC auth)
//   - User-Assigned Managed Identity (Container → Key Vault access)
//   - Azure Container Instance (MCP Gateway)
//
// Key Vault name is truncated to 24 chars (Azure limit) via substr().
// ---------------------------------------------------------------------------

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
}

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

data "azurerm_client_config" "current" {}

// ---------------------------------------------------------------------------
// Resource Group
// ---------------------------------------------------------------------------

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
}

// ---------------------------------------------------------------------------
// User-Assigned Managed Identity (used by ACI to read Key Vault secrets)
// ---------------------------------------------------------------------------

resource "azurerm_user_assigned_identity" "mcp_identity" {
  name                = "${var.container_name}-identity"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

resource "azurerm_key_vault" "mcp_kv" {
  # Azure Key Vault names must be 3-24 characters; truncate to enforce limit
  name                       = substr("${var.container_name}-kv", 0, 24)
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true
  soft_delete_retention_days = 7
}

// RBAC: Grant the deployer (Terraform SP) "Key Vault Secrets Officer" so it
// can create/update secrets during apply.
resource "azurerm_role_assignment" "kv_deployer_officer" {
  scope                = azurerm_key_vault.mcp_kv.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

// RBAC: Grant the managed identity "Key Vault Secrets User" (read-only) so
// the container can fetch secrets at runtime.
resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = azurerm_key_vault.mcp_kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.mcp_identity.principal_id
}

// ---------------------------------------------------------------------------
// Key Vault Secrets
// ---------------------------------------------------------------------------

resource "azurerm_key_vault_secret" "pg_password" {
  name         = "pg-password"
  value        = var.pg_password
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "twilio_auth_token" {
  name         = "twilio-auth-token"
  value        = var.twilio_auth_token
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "whatsapp_app_secret" {
  name         = "whatsapp-app-secret"
  value        = var.whatsapp_app_secret
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "notion_secret" {
  name         = "notion-secret"
  value        = var.notion_secret
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "elevenlabs_api_key" {
  name         = "elevenlabs-api-key"
  value        = var.elevenlabs_api_key
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "openai_api_key" {
  name         = "openai-api-key"
  value        = var.openai_api_key
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

resource "azurerm_key_vault_secret" "mcp_auth_token" {
  name         = "mcp-auth-token"
  value        = var.mcp_auth_token
  key_vault_id = azurerm_key_vault.mcp_kv.id
  depends_on   = [azurerm_role_assignment.kv_deployer_officer]
}

// ---------------------------------------------------------------------------
// Container Instance (MCP Gateway)
// ---------------------------------------------------------------------------

resource "azurerm_container_group" "mcp_gateway" {
  name                = var.container_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Linux"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.mcp_identity.id]
  }

  container {
    name   = "gateway"
    image  = var.image
    cpu    = "1"
    memory = "2"

    ports {
      port     = 8000
      protocol = "TCP"
    }

    # Non-sensitive configuration
    environment_variables = {
      PGHOST              = var.pg_host
      PGPORT              = "5432"
      PGUSER              = var.pg_user
      PGDATABASE          = var.pg_database
      WHATSAPP_VERIFY_TOKEN = var.whatsapp_verify_token
      N8N_WEBHOOK_URL     = var.n8n_url
      ELEVENLABS_VOICE_ID = var.elevenlabs_voice_id
      ELEVENLABS_MODEL_ID = var.elevenlabs_model_id
      KEY_VAULT_URI       = azurerm_key_vault.mcp_kv.vault_uri
      MANAGED_IDENTITY_CLIENT_ID = azurerm_user_assigned_identity.mcp_identity.client_id
    }

    # Sensitive values — not visible in Azure portal or API responses
    secure_environment_variables = {
      PGPASSWORD            = var.pg_password
      TWILIO_AUTH_TOKEN     = var.twilio_auth_token
      WHATSAPP_APP_SECRET   = var.whatsapp_app_secret
      NOTION_WEBHOOK_SECRET = var.notion_secret
      ELEVENLABS_API_KEY    = var.elevenlabs_api_key
      OPENAI_API_KEY        = var.openai_api_key
      MCP_AUTH_TOKEN        = var.mcp_auth_token
    }
  }

  ip_address_type = "Public"
  dns_name_label  = var.container_name

  depends_on = [azurerm_role_assignment.kv_secrets_user]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output "key_vault_name" {
  value = azurerm_key_vault.mcp_kv.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.mcp_kv.vault_uri
}

output "managed_identity_client_id" {
  value = azurerm_user_assigned_identity.mcp_identity.client_id
}
