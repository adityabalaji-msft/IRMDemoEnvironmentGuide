#!/bin/bash
# =============================================================================
# ASR Post-Failover Script for Scenario 6 ASR VMs
# =============================================================================
# Run this as part of an ASR Recovery Plan (post-action) or manually after
# failover/failback to restore full app connectivity.
#
# What it does:
#   1. Attaches a Public IP with DNS label to the main VM
#   2. Discovers the worker VM's IP and updates .env
#   3. Sets the new VM managed identity as SQL AD admin
#   4. Restarts the application service (scenario6-vm-asr)
#   5. Ensures NSG allows port 80
#
# Prerequisites:
#   - Azure CLI logged in with sufficient permissions
#   - The failover has completed (VMs are running in target RG)
#
# Usage:
#   ./asr-post-failover-vmasr.sh <target-resource-group>
#
# Examples:
#   ./asr-post-failover-vmasr.sh zr-demo-vm-asr-recovery-rg  # after failover to zone 2
#   ./asr-post-failover-vmasr.sh zr-demo-vm-asr-rg           # after failback to zone 1
# =============================================================================

set -euo pipefail

# --- Configuration ---
TARGET_RG="${1:?Usage: $0 <target-resource-group>}"
MAIN_VM_NAME="zr-vm-asr-vm"
WORKER_VM_NAME="zr-vm-asr-worker"
MAIN_NIC_NAME="zr-vm-asr-nic"
WORKER_NIC_NAME="zr-vm-asr-worker-nic"
DNS_LABEL="zr-inventory-asr"
PIP_NAME="zr-vm-asr-pip"
LOCATION="westus2"
SQL_SERVER="zr-vm-asr-ydrrjg2o6aqq2"
SQL_SERVER_RG="zr-demo-vm-asr-rg"
SUBSCRIPTION="c3d3eb0c-9ba7-4d4c-828e-cb6874714034"
APP_ENV_PATH="/opt/scenario6-vm-asr/.env"
WORKER_PORT="8081"
APP_PORT="80"
MAIN_SERVICE="scenario6-vm-asr"
WORKER_SERVICE="scenario6-worker"

# Determine the OTHER resource group
if [ "$TARGET_RG" = "zr-demo-vm-asr-rg" ]; then
  OTHER_RG="zr-demo-vm-asr-recovery-rg"
else
  OTHER_RG="zr-demo-vm-asr-rg"
fi

echo "============================================="
echo "ASR Post-Failover Recovery (VM-ASR Scenario)"
echo "============================================="
echo "Target RG:  $TARGET_RG"
echo "Other RG:   $OTHER_RG"
echo "Main VM:    $MAIN_VM_NAME"
echo "Worker VM:  $WORKER_VM_NAME"
echo "Service:    $MAIN_SERVICE"
echo "App URL:    http://${DNS_LABEL}.${LOCATION}.cloudapp.azure.com"
echo "============================================="

# --- Step 1: Public IP + DNS Label ---
echo ""
echo "[1/5] Configuring Public IP with DNS label..."

# Check if a PIP with our DNS label exists in the OTHER RG and free it
OLD_PIP=$(az network public-ip list -g "$OTHER_RG" --query "[?dnsSettings.domainNameLabel=='$DNS_LABEL'].name" -o tsv 2>/dev/null || true)
if [ -n "$OLD_PIP" ]; then
  echo "  Found old PIP '$OLD_PIP' in $OTHER_RG with DNS label. Detaching..."
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

# Check if target RG has a PIP with our DNS label
EXISTING_PIP=$(az network public-ip list -g "$TARGET_RG" --query "[?dnsSettings.domainNameLabel=='$DNS_LABEL'].name" -o tsv 2>/dev/null || true)

if [ -n "$EXISTING_PIP" ]; then
  echo "  PIP '$EXISTING_PIP' in $TARGET_RG already has DNS label."
  # Ensure it's attached to main VM NIC
  PIP_ATTACHED_TO=$(az network public-ip show -g "$TARGET_RG" -n "$EXISTING_PIP" --query "ipConfiguration.id" -o tsv 2>/dev/null || true)
  if echo "$PIP_ATTACHED_TO" | grep -qi "$MAIN_NIC_NAME"; then
    echo "  Already attached to main VM NIC. Skipping."
  else
    echo "  Attaching to main VM NIC..."
    az network nic ip-config update \
      -g "$TARGET_RG" --nic-name "$MAIN_NIC_NAME" -n "ipconfig1" \
      --public-ip-address "$EXISTING_PIP" -o none
  fi
else
  # Create a new PIP with DNS label
  echo "  Creating new PIP '$PIP_NAME' with DNS label '$DNS_LABEL'..."
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

PUBLIC_IP=$(az network public-ip list -g "$TARGET_RG" --query "[?dnsSettings.domainNameLabel=='$DNS_LABEL'].ipAddress" -o tsv 2>/dev/null || echo "unknown")
echo "  ✓ Public IP: $PUBLIC_IP ($DNS_LABEL.$LOCATION.cloudapp.azure.com)"

# --- Step 2: Discover worker IP and update .env ---
echo ""
echo "[2/5] Updating worker VM URL in .env..."

# Try the expected NIC name first, then fallback to wildcard search
WORKER_IP=$(az network nic show -g "$TARGET_RG" -n "$WORKER_NIC_NAME" --query "ipConfigurations[0].privateIpAddress" -o tsv 2>/dev/null || true)
if [ -z "$WORKER_IP" ]; then
  echo "  NIC '$WORKER_NIC_NAME' not found. Searching for worker NIC..."
  WORKER_IP=$(az network nic list -g "$TARGET_RG" --query "[?contains(name,'worker')].ipConfigurations[0].privateIpAddress" -o tsv 2>/dev/null | head -1)
fi

# Fallback to public IP if private IP not available
if [ -z "$WORKER_IP" ]; then
  echo "  No private IP found. Trying worker public IP..."
  WORKER_IP=$(az network public-ip list -g "$TARGET_RG" --query "[?contains(name,'worker')].ipAddress" -o tsv 2>/dev/null | head -1)
fi

if [ -n "$WORKER_IP" ]; then
  echo "  Worker IP: $WORKER_IP"
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
echo "[3/5] Setting VM managed identity as SQL AD admin..."

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
echo "[4/5] Restarting application services..."

# Restart worker first (main VM health check depends on it)
az vm run-command invoke \
  -g "$TARGET_RG" -n "$WORKER_VM_NAME" \
  --command-id RunShellScript \
  --scripts "systemctl restart ${WORKER_SERVICE} 2>/dev/null || systemctl restart scenario6-worker 2>/dev/null; sleep 2; systemctl is-active ${WORKER_SERVICE} 2>/dev/null || systemctl is-active scenario6-worker 2>/dev/null || echo 'service-not-found'" \
  -o none 2>/dev/null || echo "  (Worker restart skipped — may not have run-command access)"

# Restart main app
az vm run-command invoke \
  -g "$TARGET_RG" -n "$MAIN_VM_NAME" \
  --command-id RunShellScript \
  --scripts "systemctl restart ${MAIN_SERVICE}; sleep 3; systemctl is-active ${MAIN_SERVICE}" \
  -o none
echo "  ✓ Services restarted"

# --- Step 5: NSG rules for port 80 ---
echo ""
echo "[5/5] Ensuring NSG allows port $APP_PORT..."

NSG_NAME=$(az network nsg list -g "$TARGET_RG" --query "[0].name" -o tsv 2>/dev/null || true)
if [ -n "$NSG_NAME" ]; then
  EXISTING_RULE=$(az network nsg rule list -g "$TARGET_RG" --nsg-name "$NSG_NAME" \
    --query "[?destinationPortRange=='$APP_PORT' && direction=='Inbound' && access=='Allow'].name" -o tsv 2>/dev/null || true)
  if [ -z "$EXISTING_RULE" ]; then
    echo "  Adding port $APP_PORT rule to NSG '$NSG_NAME'..."
    az network nsg rule create \
      -g "$TARGET_RG" --nsg-name "$NSG_NAME" \
      -n "AllowAppHTTP" --priority 1003 \
      --direction Inbound --access Allow --protocol Tcp \
      --source-address-prefixes '*' --source-port-ranges '*' \
      --destination-address-prefixes '*' --destination-port-ranges "$APP_PORT" \
      -o none
  else
    echo "  Port $APP_PORT already allowed (rule: $EXISTING_RULE)."
  fi
else
  echo "  No NSG found in $TARGET_RG."
fi

# --- Verification ---
echo ""
echo "============================================="
echo "Post-Failover Recovery Complete!"
echo "============================================="
echo "App URL: http://${DNS_LABEL}.${LOCATION}.cloudapp.azure.com"
echo ""
echo "Verifying health endpoint..."
sleep 5
HEALTH=$(curl -s --connect-timeout 10 "http://${DNS_LABEL}.${LOCATION}.cloudapp.azure.com/health" 2>/dev/null || echo '{"status":"unreachable"}')
echo "Health: $HEALTH"
echo "============================================="
