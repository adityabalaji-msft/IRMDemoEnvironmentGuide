#!/bin/bash
# =============================================================================
# ASR Post-Failover Script
# =============================================================================
# Run this as part of an ASR Recovery Plan (post-action) or manually after
# failover/failback to restore full app connectivity.
#
# What it does:
#   1. Attaches a Public IP with DNS label to the main VM
#   2. Discovers the worker VM's private IP and updates .env
#   3. Sets the new VM managed identity as SQL AD admin
#   4. Restarts the application service
#
# Prerequisites:
#   - Azure CLI logged in with sufficient permissions
#   - The failover has completed (VMs are running in target RG)
#
# Usage:
#   ./asr-post-failover.sh <target-resource-group>
#
# Examples:
#   ./asr-post-failover.sh zr-demo-vm-rg           # after failover to zone 1
#   ./asr-post-failover.sh zr-demo-vm-recovery-rg  # after failback to zone 2
# =============================================================================

set -euo pipefail

# --- Configuration ---
TARGET_RG="${1:?Usage: $0 <target-resource-group>}"
MAIN_VM_NAME="zr-vm-zonal-vm"
WORKER_VM_NAME="zr-vm-zonal-worker"
MAIN_NIC_NAME="zr-vm-zonal-nic"
WORKER_NIC_NAME="zr-vm-zonal-worker-nic"
DNS_LABEL="zr-vm-zonal-demo"
PIP_NAME="zr-vm-zonal-pip"
LOCATION="westus2"
SQL_SERVER="zr-aks-yerto2m6texc4-sqlsvr"
SQL_SERVER_RG="zr-demo-rg-4"
SUBSCRIPTION="c3d3eb0c-9ba7-4d4c-828e-cb6874714034"
APP_ENV_PATH="/opt/scenario6-vm-zonal/.env"
WORKER_PORT="8081"

# Determine the OTHER resource group (to clean up old PIP/DNS)
if [ "$TARGET_RG" = "zr-demo-vm-rg" ]; then
  OTHER_RG="zr-demo-vm-recovery-rg"
else
  OTHER_RG="zr-demo-vm-rg"
fi

echo "============================================="
echo "ASR Post-Failover Recovery Script"
echo "============================================="
echo "Target RG:  $TARGET_RG"
echo "Other RG:   $OTHER_RG"
echo "Main VM:    $MAIN_VM_NAME"
echo "Worker VM:  $WORKER_VM_NAME"
echo "============================================="

# --- Step 1: Public IP + DNS Label ---
echo ""
echo "[1/4] Configuring Public IP with DNS label..."

# Check if a PIP with our DNS label exists in the OTHER RG and free it
OLD_PIP=$(az network public-ip list -g "$OTHER_RG" --query "[?dnsSettings.domainNameLabel=='$DNS_LABEL'].name" -o tsv 2>/dev/null || true)
if [ -n "$OLD_PIP" ]; then
  echo "  Found old PIP '$OLD_PIP' in $OTHER_RG with DNS label. Detaching..."
  # Detach from old NIC if attached
  OLD_NIC_IP_CONFIG=$(az network public-ip show -g "$OTHER_RG" -n "$OLD_PIP" --query "ipConfiguration.id" -o tsv 2>/dev/null || true)
  if [ -n "$OLD_NIC_IP_CONFIG" ] && [ "$OLD_NIC_IP_CONFIG" != "None" ]; then
    OLD_NIC_NAME=$(echo "$OLD_NIC_IP_CONFIG" | grep -oP '(?<=networkInterfaces/)[^/]+')
    OLD_NIC_RG=$(echo "$OLD_NIC_IP_CONFIG" | grep -oP '(?<=resourceGroups/)[^/]+')
    echo "  Detaching PIP from NIC $OLD_NIC_NAME in $OLD_NIC_RG..."
    az network nic ip-config update \
      -g "$OLD_NIC_RG" --nic-name "$OLD_NIC_NAME" -n "ipconfig1" \
      --remove publicIpAddress -o none 2>/dev/null || true
  fi
  echo "  Deleting old PIP '$OLD_PIP' in $OTHER_RG..."
  az network public-ip delete -g "$OTHER_RG" -n "$OLD_PIP" -o none 2>/dev/null || true
fi

# Also free DNS label from target RG if held by a different PIP
EXISTING_PIP=$(az network public-ip list -g "$TARGET_RG" --query "[?dnsSettings.domainNameLabel=='$DNS_LABEL'].name" -o tsv 2>/dev/null || true)

if [ -n "$EXISTING_PIP" ]; then
  echo "  PIP '$EXISTING_PIP' in $TARGET_RG already has DNS label."
  # Check if it's attached to our main VM's NIC
  PIP_ATTACHED_TO=$(az network public-ip show -g "$TARGET_RG" -n "$EXISTING_PIP" --query "ipConfiguration.id" -o tsv 2>/dev/null || true)
  EXPECTED_NIC_ID="/subscriptions/$SUBSCRIPTION/resourceGroups/$TARGET_RG/providers/Microsoft.Network/networkInterfaces/$MAIN_NIC_NAME"
  if echo "$PIP_ATTACHED_TO" | grep -qi "$MAIN_NIC_NAME"; then
    echo "  Already attached to main VM NIC. Skipping."
  else
    echo "  Attaching to main VM NIC..."
    az network nic ip-config update \
      -g "$TARGET_RG" --nic-name "$MAIN_NIC_NAME" -n "ipconfig1" \
      --public-ip-address "$EXISTING_PIP" -o none
  fi
else
  # Create a new PIP with the DNS label
  echo "  Creating new PIP '$PIP_NAME' with DNS label '$DNS_LABEL'..."
  # Determine the zone of the main VM
  VM_ZONE=$(az vm show -g "$TARGET_RG" -n "$MAIN_VM_NAME" --query "zones[0]" -o tsv 2>/dev/null || echo "")
  ZONE_ARG=""
  if [ -n "$VM_ZONE" ]; then
    ZONE_ARG="--zone $VM_ZONE"
  fi
  az network public-ip create \
    -g "$TARGET_RG" -n "$PIP_NAME" \
    --location "$LOCATION" \
    --allocation-method Static \
    --sku Standard \
    --dns-name "$DNS_LABEL" \
    $ZONE_ARG \
    -o none
  echo "  Attaching PIP to main VM NIC..."
  az network nic ip-config update \
    -g "$TARGET_RG" --nic-name "$MAIN_NIC_NAME" -n "ipconfig1" \
    --public-ip-address "$PIP_NAME" -o none
fi

PUBLIC_IP=$(az network public-ip show -g "$TARGET_RG" -n "$PIP_NAME" --query "ipAddress" -o tsv 2>/dev/null || echo "unknown")
echo "  ✓ Public IP: $PUBLIC_IP ($DNS_LABEL.$LOCATION.cloudapp.azure.com)"

# --- Step 2: Discover worker IP and update .env ---
echo ""
echo "[2/4] Updating worker VM URL in .env..."

WORKER_IP=$(az network nic show -g "$TARGET_RG" -n "$WORKER_NIC_NAME" --query "ipConfigurations[0].privateIpAddress" -o tsv 2>/dev/null)
if [ -z "$WORKER_IP" ]; then
  echo "  WARNING: Could not find worker NIC. Trying vm list-ip-addresses..."
  WORKER_IP=$(az vm list-ip-addresses -g "$TARGET_RG" -n "$WORKER_VM_NAME" --query "[0].virtualMachine.network.privateIpAddresses[0]" -o tsv 2>/dev/null || echo "")
fi

if [ -n "$WORKER_IP" ]; then
  echo "  Worker private IP: $WORKER_IP"
  az vm run-command invoke \
    -g "$TARGET_RG" -n "$MAIN_VM_NAME" \
    --command-id RunShellScript \
    --scripts "
      sed -i 's|WORKER_VM_URL=.*|WORKER_VM_URL=http://${WORKER_IP}:${WORKER_PORT}|' ${APP_ENV_PATH}
      echo 'Updated WORKER_VM_URL:'
      grep WORKER_VM_URL ${APP_ENV_PATH}
    " -o none
  echo "  ✓ WORKER_VM_URL updated to http://${WORKER_IP}:${WORKER_PORT}"
else
  echo "  ✗ ERROR: Could not determine worker IP!"
fi

# --- Step 3: Set managed identity as SQL AD admin ---
echo ""
echo "[3/4] Setting VM managed identity as SQL AD admin..."

VM_IDENTITY=$(az vm show -g "$TARGET_RG" -n "$MAIN_VM_NAME" --query "identity.principalId" -o tsv 2>/dev/null)
if [ -n "$VM_IDENTITY" ] && [ "$VM_IDENTITY" != "None" ]; then
  echo "  VM identity principal ID: $VM_IDENTITY"
  az sql server ad-admin create \
    --resource-group "$SQL_SERVER_RG" \
    --server-name "$SQL_SERVER" \
    --display-name "$MAIN_VM_NAME" \
    --object-id "$VM_IDENTITY" -o none
  echo "  ✓ SQL AD admin set to $MAIN_VM_NAME ($VM_IDENTITY)"
else
  echo "  ✗ ERROR: VM has no managed identity! Enable system-assigned identity first."
fi

# --- Step 4: Restart services ---
echo ""
echo "[4/4] Restarting application services..."

# Restart worker first (main VM depends on it)
az vm run-command invoke \
  -g "$TARGET_RG" -n "$WORKER_VM_NAME" \
  --command-id RunShellScript \
  --scripts "systemctl restart scenario6-worker 2>/dev/null || systemctl restart scenario6 2>/dev/null; sleep 2; systemctl is-active scenario6-worker 2>/dev/null || systemctl is-active scenario6 2>/dev/null || echo 'service-not-found'" \
  -o none 2>/dev/null || echo "  (Worker restart skipped — may not have run-command access)"

# Restart main app
az vm run-command invoke \
  -g "$TARGET_RG" -n "$MAIN_VM_NAME" \
  --command-id RunShellScript \
  --scripts "systemctl restart scenario6; sleep 3; systemctl is-active scenario6" \
  -o none
echo "  ✓ Services restarted"

# --- Verification ---
echo ""
echo "============================================="
echo "Post-Failover Recovery Complete!"
echo "============================================="
echo "App URL: http://${DNS_LABEL}.${LOCATION}.cloudapp.azure.com:8080"
echo ""
echo "Verifying health endpoint..."
sleep 5
HEALTH=$(curl -s --connect-timeout 10 "http://${DNS_LABEL}.${LOCATION}.cloudapp.azure.com:8080/health" 2>/dev/null || echo '{"status":"unreachable"}')
echo "Health: $HEALTH"
echo "============================================="
