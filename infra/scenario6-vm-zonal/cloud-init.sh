#!/bin/bash
set -euo pipefail

# =============================================================================
# Cloud-init script for Scenario 6 VM
# Installs Node.js 20, clones the app, and starts it as a systemd service
# =============================================================================

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Create app directory
mkdir -p /opt/scenario6-vm-zonal
cd /opt/scenario6-vm-zonal

# Create package.json
cat > package.json << 'PKGJSON'
{
  "name": "scenario6-vm-zonal",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "applicationinsights": "^3.0.0",
    "@azure/identity": "^4.2.0",
    "@azure/storage-blob": "^12.17.0",
    "express": "^4.18.2",
    "mssql": "^10.0.2",
    "dotenv": "^16.3.1"
  }
}
PKGJSON

# Install dependencies
npm install --production

# The app source will be deployed separately via SCP or a deploy script
# For now, create a placeholder that the deploy script will replace
mkdir -p src

# Create systemd service
cat > /etc/systemd/system/scenario6.service << 'SERVICE'
[Unit]
Description=Scenario 6 VM Zonal App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/scenario6-vm-zonal
EnvironmentFile=/opt/scenario6-vm-zonal/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

# Create empty .env (will be populated by deploy script)
touch /opt/scenario6-vm-zonal/.env

# =============================================================================
# ASR Failover Support: Auto-refresh .env on every boot
# =============================================================================
# After ASR failover, the VM may be in a different zone with new IPs.
# This script runs before the app and refreshes dynamic config from IMDS.

cat > /opt/scenario6-vm-zonal/refresh-env.sh << 'ENVSCRIPT'
#!/bin/bash
# Refresh environment variables from Azure IMDS on each boot
# Ensures correct config after ASR zone-to-zone failover

ENV_FILE="/opt/scenario6-vm-zonal/.env"

# Wait for IMDS to be available (may take a moment after failover boot)
for i in $(seq 1 30); do
  if curl -s -f -H "Metadata:true" --connect-timeout 2 "http://169.254.169.254/metadata/instance?api-version=2021-02-01" > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Get current zone from IMDS
CURRENT_ZONE=$(curl -s -H "Metadata:true" "http://169.254.169.254/metadata/instance/compute/zone?api-version=2021-02-01&format=text" 2>/dev/null || echo "unknown")

# Get VM name from IMDS
CURRENT_VM=$(curl -s -H "Metadata:true" "http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text" 2>/dev/null || echo "unknown")

if [ -f "$ENV_FILE" ]; then
  # Update VM_ZONE with actual zone from IMDS
  if grep -q "^VM_ZONE=" "$ENV_FILE"; then
    sed -i "s/^VM_ZONE=.*/VM_ZONE=${CURRENT_ZONE}/" "$ENV_FILE"
  else
    echo "VM_ZONE=${CURRENT_ZONE}" >> "$ENV_FILE"
  fi

  # Update VM_NAME with actual VM name from IMDS
  if grep -q "^VM_NAME=" "$ENV_FILE"; then
    sed -i "s/^VM_NAME=.*/VM_NAME=${CURRENT_VM}/" "$ENV_FILE"
  else
    echo "VM_NAME=${CURRENT_VM}" >> "$ENV_FILE"
  fi

  # Update WORKER_VM_URL to use Private DNS hostname (survives failover)
  WORKER_DNS="http://zr-vm-zonal-worker.scenario6.internal:8081"
  if grep -q "^WORKER_VM_URL=" "$ENV_FILE"; then
    sed -i "s|^WORKER_VM_URL=.*|WORKER_VM_URL=${WORKER_DNS}|" "$ENV_FILE"
  else
    echo "WORKER_VM_URL=${WORKER_DNS}" >> "$ENV_FILE"
  fi

  echo "[env-refresh] Updated .env: VM_ZONE=${CURRENT_ZONE}, VM_NAME=${CURRENT_VM}, WORKER_VM_URL=${WORKER_DNS}"
else
  echo "[env-refresh] WARNING: ${ENV_FILE} not found"
fi
ENVSCRIPT
chmod +x /opt/scenario6-vm-zonal/refresh-env.sh

# Systemd service: runs on every boot BEFORE the app to refresh config
cat > /etc/systemd/system/scenario6-env-refresh.service << 'REFRESHSVC'
[Unit]
Description=Refresh Scenario 6 env from IMDS (ASR failover support)
Before=scenario6.service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scenario6-vm-zonal/refresh-env.sh
RemainAfterExit=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
REFRESHSVC

systemctl daemon-reload
systemctl enable scenario6-env-refresh.service
systemctl enable scenario6.service

echo "[INFO] Scenario 6 VM setup complete. Deploy app code and .env, then: systemctl start scenario6"
