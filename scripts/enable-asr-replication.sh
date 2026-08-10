#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Enable ASR Zone-to-Zone Replication for Scenario 6-ASR VMs
# =============================================================================
# Run this AFTER deploying the scenario6-vm-asr Bicep template.
# The Bicep creates the vault, fabrics, containers, and policy.
# This script enables replication on the individual VMs.
#
# Usage:
#   ./scripts/enable-asr-replication.sh <resource-group> [location]
#
# Example:
#   ./scripts/enable-asr-replication.sh zr-demo-vm-asr-rg westus2
# =============================================================================

RESOURCE_GROUP="${1:?Usage: $0 <resource-group> [location]}"
LOCATION="${2:-westus2}"
BASE_NAME="zr-vm-asr"
RECOVERY_RG="${RESOURCE_GROUP}-recovery"

echo "============================================="
echo "ASR Zone-to-Zone Replication Setup"
echo "============================================="
echo "Resource Group:  $RESOURCE_GROUP"
echo "Recovery RG:     $RECOVERY_RG"
echo "Location:        $LOCATION"
echo "============================================="

# --- Ensure recovery RG exists ---
echo ""
echo "[0/5] Ensuring recovery resource group exists: $RECOVERY_RG"
az group create --name "$RECOVERY_RG" --location "$LOCATION" -o none

# --- Gather deployment outputs ---
echo ""
echo "[1/5] Reading Bicep deployment outputs..."

VAULT_NAME=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.asrVaultName.value" -o tsv 2>/dev/null || echo "${BASE_NAME}-rsv")

VM_NAME=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.vmName.value" -o tsv 2>/dev/null || echo "${BASE_NAME}-vm")

WORKER_VM_NAME=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.workerVmName.value" -o tsv 2>/dev/null || echo "${BASE_NAME}-worker")

VM_ID=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.vmResourceId.value" -o tsv 2>/dev/null || \
  az vm show -g "$RESOURCE_GROUP" -n "$VM_NAME" --query id -o tsv)

WORKER_VM_ID=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.workerVmResourceId.value" -o tsv 2>/dev/null || \
  az vm show -g "$RESOURCE_GROUP" -n "$WORKER_VM_NAME" --query id -o tsv)

SOURCE_ZONE=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.vmZone.value" -o tsv 2>/dev/null || echo "1")

TARGET_ZONE=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.targetZone.value" -o tsv 2>/dev/null || echo "2")

CACHE_STORAGE_ID=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.asrCacheStorageId.value" -o tsv 2>/dev/null)

SOURCE_CONTAINER_ID=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.asrSourceContainerId.value" -o tsv 2>/dev/null)

echo "  Vault:            $VAULT_NAME"
echo "  Main VM:          $VM_NAME (zone $SOURCE_ZONE)"
echo "  Worker VM:        $WORKER_VM_NAME (zone $SOURCE_ZONE)"
echo "  Target zone:      $TARGET_ZONE"

# --- Resolve fabric & container names from the container ID ---
# Container ID format: .../replicationFabrics/{fabric}/replicationProtectionContainers/{container}
SOURCE_FABRIC_NAME=$(echo "$SOURCE_CONTAINER_ID" | grep -oP '(?<=replicationFabrics/)[^/]+')
SOURCE_CONTAINER_NAME=$(echo "$SOURCE_CONTAINER_ID" | grep -oP '(?<=replicationProtectionContainers/)[^/]+')

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RG_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}"
RECOVERY_RG_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RECOVERY_RG}"

# Get the VNet ID (recovery VMs will use the same VNet)
VNET_ID=$(az network vnet list -g "$RESOURCE_GROUP" --query "[0].id" -o tsv)

# --- Get OS disk IDs for both VMs ---
echo ""
echo "[2/5] Getting VM disk information..."

VM_OS_DISK_ID=$(az vm show -g "$RESOURCE_GROUP" -n "$VM_NAME" \
  --query "storageProfile.osDisk.managedDisk.id" -o tsv)
echo "  Main VM OS disk:   $VM_OS_DISK_ID"

WORKER_OS_DISK_ID=$(az vm show -g "$RESOURCE_GROUP" -n "$WORKER_VM_NAME" \
  --query "storageProfile.osDisk.managedDisk.id" -o tsv)
echo "  Worker VM OS disk: $WORKER_OS_DISK_ID"

# --- Enable replication for the main VM ---
echo ""
echo "[3/5] Enabling ASR replication for main VM ($VM_NAME)..."
echo "  Source zone: $SOURCE_ZONE → Target zone: $TARGET_ZONE"
echo "  Recovery RG: $RECOVERY_RG"

TARGET_CONTAINER_ID=$(az deployment group show -g "$RESOURCE_GROUP" -n "main" \
  --query "properties.outputs.asrTargetContainerId.value" -o tsv)

POLICY_ID=$(az site-recovery policy show \
  -g "$RESOURCE_GROUP" --vault-name "$VAULT_NAME" \
  -n "${BASE_NAME}-repl-policy" --query id -o tsv)

# Use the kebab-case nested JSON format required by az site-recovery CLI
az site-recovery protected-item create \
  --resource-group "$RESOURCE_GROUP" \
  --vault-name "$VAULT_NAME" \
  --fabric-name "$SOURCE_FABRIC_NAME" \
  --protection-container "$SOURCE_CONTAINER_NAME" \
  --name "${VM_NAME}-repl" \
  --policy-id "$POLICY_ID" \
  --provider-details "{\"a2a\":{\"fabric-object-id\":\"$VM_ID\",\"recovery-container-id\":\"$TARGET_CONTAINER_ID\",\"recovery-resource-group-id\":\"$RECOVERY_RG_ID\",\"recovery-availability-zone\":\"$TARGET_ZONE\",\"recovery-azure-network-id\":\"$VNET_ID\",\"recovery-subnet-name\":\"default\",\"multi-vm-group-name\":\"scenario6-asr-group\",\"vm-managed-disks\":[{\"disk-id\":\"$VM_OS_DISK_ID\",\"primary-staging-azure-storage-account-id\":\"$CACHE_STORAGE_ID\",\"recovery-resource-group-id\":\"$RECOVERY_RG_ID\",\"recovery-target-disk-account-type\":\"Standard_LRS\",\"recovery-replica-disk-account-type\":\"Standard_LRS\"}]}}" \
  --no-wait \
  -o none

echo "  ✓ Replication initiated for $VM_NAME (async)"

# --- Enable replication for the worker VM ---
echo ""
echo "[4/5] Enabling ASR replication for worker VM ($WORKER_VM_NAME)..."

az site-recovery protected-item create \
  --resource-group "$RESOURCE_GROUP" \
  --vault-name "$VAULT_NAME" \
  --fabric-name "$SOURCE_FABRIC_NAME" \
  --protection-container "$SOURCE_CONTAINER_NAME" \
  --name "${WORKER_VM_NAME}-repl" \
  --policy-id "$POLICY_ID" \
  --provider-details "{\"a2a\":{\"fabric-object-id\":\"$WORKER_VM_ID\",\"recovery-container-id\":\"$TARGET_CONTAINER_ID\",\"recovery-resource-group-id\":\"$RECOVERY_RG_ID\",\"recovery-availability-zone\":\"$TARGET_ZONE\",\"recovery-azure-network-id\":\"$VNET_ID\",\"recovery-subnet-name\":\"default\",\"multi-vm-group-name\":\"scenario6-asr-group\",\"vm-managed-disks\":[{\"disk-id\":\"$WORKER_OS_DISK_ID\",\"primary-staging-azure-storage-account-id\":\"$CACHE_STORAGE_ID\",\"recovery-resource-group-id\":\"$RECOVERY_RG_ID\",\"recovery-target-disk-account-type\":\"Standard_LRS\",\"recovery-replica-disk-account-type\":\"Standard_LRS\"}]}}" \
  --no-wait \
  -o none

echo "  ✓ Replication initiated for $WORKER_VM_NAME (async)"

# --- Monitor initial replication ---
echo ""
echo "[5/5] Replication jobs started. Monitoring initial sync..."
echo ""
echo "  Both VMs are replicating from zone $SOURCE_ZONE → zone $TARGET_ZONE"
echo "  in the multi-VM consistency group 'scenario6-asr-group'."
echo ""
echo "  Check replication status:"
echo "    az site-recovery protected-item list \\"
echo "      -g $RESOURCE_GROUP --vault-name $VAULT_NAME \\"
echo "      --fabric-name $SOURCE_FABRIC_NAME \\"
echo "      --protection-container $SOURCE_CONTAINER_NAME \\"
echo "      --query '[].{Name:name, State:properties.protectionState, Health:properties.replicationHealth}' -o table"
echo ""
echo "============================================="
echo "ASR Setup Complete!"
echo "============================================="
echo ""
echo "After initial sync completes (~30-60 min), you can test failover:"
echo "  1. Test failover:     az site-recovery protected-item test-failover ..."
echo "  2. Planned failover:  az site-recovery protected-item planned-failover ..."
echo "  3. Post-failover:     ./scripts/asr-post-failover.sh $RESOURCE_GROUP"
echo ""
