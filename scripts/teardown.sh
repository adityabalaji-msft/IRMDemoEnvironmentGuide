#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Teardown script — deletes the demo resource group
# =============================================================================
# Usage:
#   ./scripts/teardown.sh [resource-group]
#
# Example:
#   ./scripts/teardown.sh zr-demo-rg
# =============================================================================

RESOURCE_GROUP="${1:-zr-demo-rg}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required."
  exit 1
fi

echo "You are about to delete resource group: $RESOURCE_GROUP"
read -r -p "Type 'delete' to confirm: " CONFIRM

if [[ "$CONFIRM" != "delete" ]]; then
  echo "Cancelled."
  exit 0
fi

echo "[INFO] Deleting resource group $RESOURCE_GROUP ..."
az group delete --name "$RESOURCE_GROUP" --yes --no-wait

echo "[INFO] Deletion initiated."
echo "Use: az group show -n $RESOURCE_GROUP to verify when fully deleted."
