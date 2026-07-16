#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Deploy all zonal resiliency demo scenarios (1..5)
# =============================================================================
# Usage:
#   ./scripts/deploy-all.sh [resource-group] [location]
#
# Example:
#   ./scripts/deploy-all.sh zr-demo-rg eastus
# =============================================================================

RESOURCE_GROUP="${1:-zr-demo-rg}"
LOCATION="${2:-eastus}"

if [[ ! -x "scripts/deploy-scenario.sh" ]]; then
  chmod +x scripts/deploy-scenario.sh
fi

echo "==============================================================="
echo "Deploying ALL scenarios to:"
echo "Resource Group: $RESOURCE_GROUP"
echo "Location:       $LOCATION"
echo "==============================================================="

echo
echo "Entra admin identity will be auto-resolved from the signed-in user."
echo

for SCENARIO in 1 2 3 4 5; do
  echo "---------------------------------------------------------------"
  echo "Deploying Scenario $SCENARIO"
  echo "---------------------------------------------------------------"
  ./scripts/deploy-scenario.sh "$SCENARIO" "$RESOURCE_GROUP" "$LOCATION"
  echo
  echo "Scenario $SCENARIO completed."
  echo
  sleep 2
done

echo "==============================================================="
echo "All scenarios deployed successfully."
echo "==============================================================="
echo
echo "Next steps:"
echo "1) Deploy application code to App Services and AKS"
echo "2) Run load generation scripts to populate App Insights dependency maps"
echo "3) Validate risk scenarios in docs/scenarios.md"
