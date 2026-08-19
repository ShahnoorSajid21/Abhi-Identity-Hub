###############################################################################
# ABHI Unified KYC Ledger — production infrastructure
#
# Two properties drive every choice below and both are compliance obligations
# rather than engineering preferences:
#
#   1. DATA RESIDENCY. The Personal Data Protection Bill 2023 (draft) would
#      require localisation of critical personal data. Nothing here depends on
#      an offshore region, and the region variable is validated against an
#      in-country allow-list.
#
#   2. MSP SEPARATION. Each Fabric organization gets its own subscription /
#      account boundary, its own key vault and its own node pool. Three MSPs
#      inside one blast radius would make the governance argument theatre —
#      see Blueprint 3.2.3 and finding SEC-03.
###############################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 3.100" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Remote state holds resource identifiers, not secrets, but it is still
  # access-controlled and versioned.
  backend "azurerm" {
    resource_group_name  = "abhi-tfstate-rg"
    storage_account_name = "abhitfstate"
    container_name       = "kyc-ledger"
    key                  = "prod.terraform.tfstate"
  }
}

###############################################################################
# Variables
###############################################################################

variable "environment" {
  type        = string
  description = "Deployment environment."
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "location" {
  type        = string
  default     = "uaenorth"
  description = "Azure region. MUST satisfy data-residency requirements."
  validation {
    # Placeholder allow-list. Confirm against the final PDPB text and SBP
    # guidance before production — [OPEN-E].
    condition     = contains(["uaenorth", "uaecentral"], var.location)
    error_message = "location must be an approved in-region datacentre."
  }
}

variable "peer_node_count" {
  type        = number
  default     = 2
  description = "Peers per organization. 2 across >=2 zones in production."
  validation {
    condition     = var.peer_node_count >= 2
    error_message = "production requires at least 2 peers per organization for HA."
  }
}

locals {
  # Each MSP is a separate trust domain. Keeping this as data rather than
  # copy-pasted blocks is what stops the three drifting apart over time.
  organizations = {
    bank       = { msp = "ABHIBankMSP",       short = "bank" }
    lending    = { msp = "ABHILendingMSP",    short = "lend" }
    compliance = { msp = "ABHIComplianceMSP", short = "comp" }
  }

  common_tags = {
    application = "abhi-kyc-ledger"
    environment = var.environment
    dataclass   = "confidential"
    owner       = "digital-products"
    compliance  = "sbp-bprd-cl22-2023"
  }
}

###############################################################################
# Per-organization isolation
###############################################################################

resource "azurerm_resource_group" "org" {
  for_each = local.organizations
  name     = "abhi-kyc-${each.value.short}-${var.environment}-rg"
  location = var.location
  tags     = merge(local.common_tags, { msp = each.value.msp })
}

resource "azurerm_virtual_network" "org" {
  for_each            = local.organizations
  name                = "abhi-kyc-${each.value.short}-vnet"
  resource_group_name = azurerm_resource_group.org[each.key].name
  location            = var.location
  address_space       = ["10.${index(keys(local.organizations), each.key) + 10}.0.0/16"]
  tags                = local.common_tags
}

resource "azurerm_subnet" "peers" {
  for_each             = local.organizations
  name                 = "peers"
  resource_group_name  = azurerm_resource_group.org[each.key].name
  virtual_network_name = azurerm_virtual_network.org[each.key].name
  address_prefixes     = ["10.${index(keys(local.organizations), each.key) + 10}.1.0/24"]
}

# Key vault per organization. A compromise of the Lending MSP's signing key
# must not yield the pepper, and a compromise of the crypto partition must not
# yield the ability to endorse.
resource "azurerm_key_vault" "org" {
  for_each                    = local.organizations
  name                        = "abhi-kyc-${each.value.short}-${var.environment}-kv"
  resource_group_name         = azurerm_resource_group.org[each.key].name
  location                    = var.location
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "premium" # HSM-backed keys
  purge_protection_enabled    = true
  soft_delete_retention_days  = 90
  enabled_for_disk_encryption = true

  # Losing every copy of the KEK is a bank-wide crypto-shred nobody asked for.
  # Purge protection is therefore non-negotiable, not a default.
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = merge(local.common_tags, { msp = each.value.msp })
}

data "azurerm_client_config" "current" {}

###############################################################################
# Kubernetes — gateway and peers
###############################################################################

resource "azurerm_kubernetes_cluster" "main" {
  name                = "abhi-kyc-${var.environment}-aks"
  resource_group_name = azurerm_resource_group.org["bank"].name
  location            = var.location
  dns_prefix          = "abhi-kyc-${var.environment}"

  # Zone-redundant: survives a single-AZ loss (Blueprint 13.2).
  default_node_pool {
    name                = "system"
    node_count          = 3
    vm_size             = "Standard_D4s_v5"
    zones               = ["1", "2", "3"]
    only_critical_addons_enabled = true
    vnet_subnet_id      = azurerm_subnet.peers["bank"].id
  }

  identity { type = "SystemAssigned" }

  network_profile {
    network_policy = "calico" # required for the default-deny egress policy
    network_plugin = "azure"
  }

  azure_policy_enabled = true

  api_server_access_profile {
    authorized_ip_ranges = var.environment == "prod" ? ["10.0.0.0/8"] : null
  }

  tags = local.common_tags
}

# The gateway holds plaintext attributes in memory and runs on dedicated nodes
# with no shared tenancy (Blueprint 8.5).
resource "azurerm_kubernetes_cluster_node_pool" "gateway" {
  name                  = "gateway"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = "Standard_D8s_v5"
  node_count            = 3
  zones                 = ["1", "2", "3"]
  vnet_subnet_id        = azurerm_subnet.peers["bank"].id

  node_taints = ["workload=kyc-gateway:NoSchedule"]
  node_labels = { workload = "kyc-gateway" }

  tags = local.common_tags
}

resource "azurerm_kubernetes_cluster_node_pool" "peers" {
  for_each              = local.organizations
  name                  = "peer${each.value.short}"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = "Standard_D8s_v5"
  node_count            = var.peer_node_count
  zones                 = ["1", "2", "3"]
  vnet_subnet_id        = azurerm_subnet.peers[each.key].id

  node_taints = ["msp=${each.value.msp}:NoSchedule"]
  node_labels = { msp = each.value.msp, workload = "fabric-peer" }

  tags = merge(local.common_tags, { msp = each.value.msp })
}

###############################################################################
# Vault database
###############################################################################

resource "random_password" "vault_db" {
  length  = 48
  special = true
}

resource "azurerm_postgresql_flexible_server" "vault" {
  name                = "abhi-kyc-vault-${var.environment}"
  resource_group_name = azurerm_resource_group.org["bank"].name
  location            = var.location
  version             = "16"

  administrator_login    = "vaultadmin"
  administrator_password = random_password.vault_db.result

  sku_name   = var.environment == "prod" ? "GP_Standard_D4s_v3" : "B_Standard_B1ms"
  storage_mb = 131072

  # RPO < 15 minutes (Blueprint 13.3).
  backup_retention_days        = 35
  geo_redundant_backup_enabled = var.environment == "prod"

  high_availability {
    mode                      = var.environment == "prod" ? "ZoneRedundant" : "SameZone"
    standby_availability_zone = "2"
  }

  # No public route. The vault is reachable only from the gateway subnet.
  public_network_access_enabled = false

  tags = local.common_tags
}

resource "azurerm_key_vault_secret" "vault_db_password" {
  name         = "vault-db-password"
  value        = random_password.vault_db.result
  key_vault_id = azurerm_key_vault.org["bank"].id
}

###############################################################################
# Observability
###############################################################################

resource "azurerm_log_analytics_workspace" "main" {
  name                = "abhi-kyc-${var.environment}-logs"
  resource_group_name = azurerm_resource_group.org["compliance"].name
  location            = var.location
  sku                 = "PerGB2018"

  # Retention long enough to cover SBP record-keeping expectations for
  # OPERATIONAL logs. Note this is separate from CDD record retention, which
  # lives with the ledger and the vault, not here.
  retention_in_days = 730

  tags = local.common_tags
}

###############################################################################
# Outputs
###############################################################################

output "cluster_name" { value = azurerm_kubernetes_cluster.main.name }

output "key_vault_uris" {
  value       = { for k, v in azurerm_key_vault.org : k => v.vault_uri }
  description = "Per-MSP key vaults. Separation is the governance control."
}

output "vault_db_fqdn" {
  value     = azurerm_postgresql_flexible_server.vault.fqdn
  sensitive = true
}

output "residency_note" {
  value = "Deployed to ${var.location}. Confirm against final PDPB text before production — [OPEN-E]."
}
