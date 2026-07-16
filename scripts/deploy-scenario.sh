#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Deploy a single scenario for Zonal Resiliency migration demo
# =============================================================================
# Usage:
#   ./scripts/deploy-scenario.sh <scenario-number> [resource-group] [location]
#
# Examples:
#   ./scripts/deploy-scenario.sh 1
#   ./scripts/deploy-scenario.sh 4 zr-demo-rg eastus
#   ./scripts/deploy-scenario.sh 4-local              # SQL + Storage only (no AKS) for local dev
# =============================================================================

SCENARIO="${1:-}"
RESOURCE_GROUP="${2:-zr-demo-rg}"
LOCATION="${3:-eastus}"

if [[ -z "$SCENARIO" ]]; then
  echo "Usage: $0 <scenario-number 1-5 or 4-local> [resource-group] [location]"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Install: https://aka.ms/azure-cli"
  exit 1
fi

echo "[INFO] Ensuring resource group exists: $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

SCENARIO_DIR=""
BASE_NAME=""

case "$SCENARIO" in
  1)
    SCENARIO_DIR="infra/scenario1-safe"
    BASE_NAME="zr-safe"
    ;;
  2)
    SCENARIO_DIR="infra/scenario2-hardcoded"
    BASE_NAME="zr-risky"
    ;;
  3)
    SCENARIO_DIR="infra/scenario3-shared"
    BASE_NAME="zr-shared"
    ;;
  4)
    SCENARIO_DIR="infra/scenario4-aks"
    BASE_NAME="zr-aks"
    ;;
  5)
    SCENARIO_DIR="infra/scenario5-replacement"
    BASE_NAME="zr-replace"
    ;;
  4-local)
    # Lightweight local dev: provision SQL + Storage only (no AKS)
    # Uses Entra-only auth (no SQL password) to comply with org policy
    BASE_NAME="zr-aks-local"
    UNIQUE_SUFFIX=$(echo "$RESOURCE_GROUP$LOCATION" | md5sum | head -c 8)
    SQL_SERVER_NAME="${BASE_NAME}-sqlsvr-${UNIQUE_SUFFIX}"
    SQL_DB_NAME="${BASE_NAME}-db"
    STORAGE_ACCOUNT_NAME="zrlocal${UNIQUE_SUFFIX}"

    echo "[INFO] Provisioning SQL + Storage for local dev testing (no AKS)..."
    echo "[INFO] Using Entra-only authentication (org policy compliant)"

    # Resolve signed-in user for Entra admin
    ENTRA_ADMIN_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
    ENTRA_ADMIN_OID=$(az ad signed-in-user show --query id -o tsv)
    echo "[INFO] Entra admin: $ENTRA_ADMIN_UPN ($ENTRA_ADMIN_OID)"

    # --- SQL Server (Entra-only auth) + Database ---
    echo "[INFO] Creating SQL Server: $SQL_SERVER_NAME (Entra-only auth)"
    az sql server create \
      --name "$SQL_SERVER_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --enable-ad-only-auth \
      --external-admin-principal-type "User" \
      --external-admin-name "$ENTRA_ADMIN_UPN" \
      --external-admin-sid "$ENTRA_ADMIN_OID" \
      --output none

    echo "[INFO] Creating SQL Database: $SQL_DB_NAME"
    az sql db create \
      --name "$SQL_DB_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --server "$SQL_SERVER_NAME" \
      --service-objective Basic \
      --output none

    echo "[INFO] Configuring firewall — allowing current client IP"
    MY_IP=$(curl -s https://api.ipify.org)
    az sql server firewall-rule create \
      --name "AllowMyIP" \
      --resource-group "$RESOURCE_GROUP" \
      --server "$SQL_SERVER_NAME" \
      --start-ip-address "$MY_IP" \
      --end-ip-address "$MY_IP" \
      --output none

    SQL_FQDN="${SQL_SERVER_NAME}.database.windows.net"

    # --- Storage Account + Container + Seed Data ---
    echo "[INFO] Creating Storage Account: $STORAGE_ACCOUNT_NAME"
    az storage account create \
      --name "$STORAGE_ACCOUNT_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --sku Standard_LRS \
      --output none

    STORAGE_KEY=$(az storage account keys list \
      --account-name "$STORAGE_ACCOUNT_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query "[0].value" -o tsv)

    echo "[INFO] Creating container: demo-data"
    az storage container create \
      --name "demo-data" \
      --account-name "$STORAGE_ACCOUNT_NAME" \
      --account-key "$STORAGE_KEY" \
      --output none

    echo "[INFO] Seeding sample blob"
    echo "sample-asset-data" | az storage blob upload \
      --container-name "demo-data" \
      --name "sample-asset.txt" \
      --account-name "$STORAGE_ACCOUNT_NAME" \
      --account-key "$STORAGE_KEY" \
      --data @- \
      --overwrite \
      --output none

    STORAGE_EP="https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net"

    echo
    echo "==============================================================="
    echo "Scenario 4 LOCAL DEV resources deployed successfully"
    echo "Resource Group: $RESOURCE_GROUP"
    echo "SQL Auth:       Entra-only (DefaultAzureCredential)"
    echo "==============================================================="
    echo
    echo "Run the backend (Terminal 1):"
    echo "  cd apps/scenario4-backend"
    echo "  npm install @azure/identity"
    echo "  # Linux/macOS:"
    echo "  export PORT=3000 SQL_SERVER=$SQL_FQDN SQL_DATABASE=$SQL_DB_NAME SQL_AUTH_TYPE=entra"
    echo "  npm start"
    echo "  # Windows CMD:"
    echo "  set PORT=3000 && set SQL_SERVER=$SQL_FQDN && set SQL_DATABASE=$SQL_DB_NAME && set SQL_AUTH_TYPE=entra && npm start"
    echo
    echo "Run the frontend (Terminal 2):"
    echo "  cd apps/scenario4-frontend"
    echo "  # Linux/macOS:"
    echo "  export BACKEND_URL=http://localhost:3000 STORAGE_ACCOUNT_URL=$STORAGE_EP"
    echo "  npm start"
    echo "  # Windows CMD:"
    echo "  set BACKEND_URL=http://localhost:3000 && set STORAGE_ACCOUNT_URL=$STORAGE_EP && npm start"
    echo
    echo "Open: http://localhost:8080"
    echo "==============================================================="
    exit 0
    ;;
  *)
    echo "Invalid scenario: $SCENARIO. Must be 1-5 or 4-local."
    exit 1
    ;;
esac

PARAM_FILE="$SCENARIO_DIR/parameters.json"
MAIN_FILE="$SCENARIO_DIR/main.bicep"

if [[ ! -f "$MAIN_FILE" ]]; then
  echo "[ERROR] Missing Bicep file: $MAIN_FILE"
  exit 1
fi

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "[ERROR] Missing parameters file: $PARAM_FILE"
  exit 1
fi

# Resolve Entra admin identity for SQL Server
ENTRA_ADMIN_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ENTRA_ADMIN_OID=$(az ad signed-in-user show --query id -o tsv)
echo "[INFO] Using Entra admin: $ENTRA_ADMIN_UPN ($ENTRA_ADMIN_OID)"

DEPLOYMENT_NAME="scenario${SCENARIO}-$(date +%Y%m%d%H%M%S)"
echo "[INFO] Deploying Scenario $SCENARIO with deployment name: $DEPLOYMENT_NAME"

# Deploy infra
DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DEPLOYMENT_NAME" \
  --template-file "$MAIN_FILE" \
  --parameters "@$PARAM_FILE" entraAdminLogin="$ENTRA_ADMIN_UPN" entraAdminObjectId="$ENTRA_ADMIN_OID" \
  --query properties.outputs -o json)

echo "[INFO] Deployment completed."

# =============================================================================
# Scenario-specific post-deployment steps
# =============================================================================

if [[ "$SCENARIO" == "2" ]]; then
  echo "[INFO] Applying hard-coded endpoints for Scenario 2 app source..."
  SQL_FQDN=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.sqlServerFqdn.value" -o tsv)
  SQL_DB=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.sqlDatabaseName.value" -o tsv)
  STORAGE_EP=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.storageEndpoint.value" -o tsv)

  if [[ -n "$SQL_FQDN" && -n "$SQL_DB" && -n "$STORAGE_EP" ]]; then
    # Replace hard-coded markers in source code
    sed -i.bak "s/HARDCODED_SQL_SERVER_FQDN/${SQL_FQDN}/g" apps/scenario2-hardcoded/src/index.js
    sed -i.bak "s/HARDCODED_SQL_DATABASE/${SQL_DB}/g" apps/scenario2-hardcoded/src/index.js
    sed -i.bak "s|HARDCODED_STORAGE_ENDPOINT|${STORAGE_EP}|g" apps/scenario2-hardcoded/src/index.js
    rm -f apps/scenario2-hardcoded/src/index.js.bak
    echo "[INFO] Scenario 2 source updated with hard-coded Azure endpoints."
  else
    echo "[WARN] Could not resolve all output values for Scenario 2 hard-coded injection."
  fi
fi

if [[ "$SCENARIO" == "4" ]]; then
  echo "[INFO] Preparing AKS ConfigMap placeholders for Scenario 4..."
  SQL_FQDN=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.sqlServerFqdn.value" -o tsv)
  SQL_DB=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.sqlDatabaseName.value" -o tsv)
  STORAGE_EP=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.storageEndpoint.value" -o tsv)

  sed -i.bak "s/PLACEHOLDER_SQL_SERVER_FQDN/${SQL_FQDN}/g" apps/scenario4-backend/k8s/configmap.yaml
  sed -i.bak "s/PLACEHOLDER_SQL_DATABASE/${SQL_DB}/g" apps/scenario4-backend/k8s/configmap.yaml
  sed -i.bak "s|PLACEHOLDER_STORAGE_ENDPOINT|${STORAGE_EP}|g" apps/scenario4-backend/k8s/configmap.yaml
  rm -f apps/scenario4-backend/k8s/configmap.yaml.bak

  echo "[INFO] Scenario 4 ConfigMap updated with deployment outputs."
  echo "[NEXT] Build/push images, then apply manifests:"
  echo "       kubectl apply -f apps/scenario4-backend/k8s/configmap.yaml"
  echo "       kubectl apply -f apps/scenario4-backend/k8s/deployment.yaml"
  echo "       kubectl apply -f apps/scenario4-frontend/k8s/deployment.yaml"
fi

echo

echo "==============================================================="
echo "Scenario $SCENARIO deployed successfully"
echo "Resource Group: $RESOURCE_GROUP"
echo "Deployment:     $DEPLOYMENT_NAME"
echo "==============================================================="
echo "Outputs (raw JSON):"
echo "$DEPLOY_OUTPUT"
