#!/bin/bash
set -euo pipefail

# =============================================================================
# Cloud-init script for Scenario 6 Worker VM
# Installs Node.js 20 and sets up the data-sync-agent as a systemd service
# =============================================================================

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Create app directory
mkdir -p /opt/scenario6-vm-worker
cd /opt/scenario6-vm-worker

# Create package.json
cat > package.json << 'PKGJSON'
{
  "name": "scenario6-vm-worker",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.3.1"
  }
}
PKGJSON

# Install dependencies
npm install --production

# Create placeholder for app code
mkdir -p src

# Create systemd service
cat > /etc/systemd/system/scenario6-worker.service << 'SERVICE'
[Unit]
Description=Scenario 6 Worker VM - Data Sync Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/scenario6-vm-worker
EnvironmentFile=/opt/scenario6-vm-worker/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

# Create empty .env (will be populated by deploy script)
touch /opt/scenario6-vm-worker/.env

# =============================================================================
# ASR Failover Support: Auto-refresh .env on every boot
# =============================================================================
cat > /opt/scenario6-vm-worker/refresh-env.sh << 'ENVSCRIPT'
#!/bin/bash
# Refresh environment variables from Azure IMDS on each boot
# Ensures correct config after ASR zone-to-zone failover

ENV_FILE="/opt/scenario6-vm-worker/.env"

# Wait for IMDS to be available
for i in $(seq 1 30); do
  if curl -s -f -H "Metadata:true" --connect-timeout 2 "http://169.254.169.254/metadata/instance?api-version=2021-02-01" > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Get current zone and VM name from IMDS
CURRENT_ZONE=$(curl -s -H "Metadata:true" "http://169.254.169.254/metadata/instance/compute/zone?api-version=2021-02-01&format=text" 2>/dev/null || echo "unknown")
CURRENT_VM=$(curl -s -H "Metadata:true" "http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text" 2>/dev/null || echo "unknown")

if [ -f "$ENV_FILE" ]; then
  if grep -q "^VM_ZONE=" "$ENV_FILE"; then
    sed -i "s/^VM_ZONE=.*/VM_ZONE=${CURRENT_ZONE}/" "$ENV_FILE"
  else
    echo "VM_ZONE=${CURRENT_ZONE}" >> "$ENV_FILE"
  fi

  if grep -q "^VM_NAME=" "$ENV_FILE"; then
    sed -i "s/^VM_NAME=.*/VM_NAME=${CURRENT_VM}/" "$ENV_FILE"
  else
    echo "VM_NAME=${CURRENT_VM}" >> "$ENV_FILE"
  fi

  echo "[env-refresh] Updated .env: VM_ZONE=${CURRENT_ZONE}, VM_NAME=${CURRENT_VM}"
else
  echo "[env-refresh] WARNING: ${ENV_FILE} not found"
fi
ENVSCRIPT
chmod +x /opt/scenario6-vm-worker/refresh-env.sh

cat > /etc/systemd/system/scenario6-worker-env-refresh.service << 'REFRESHSVC'
[Unit]
Description=Refresh Scenario 6 Worker env from IMDS (ASR failover support)
Before=scenario6-worker.service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/scenario6-vm-worker/refresh-env.sh
RemainAfterExit=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
REFRESHSVC

systemctl daemon-reload
systemctl enable scenario6-worker-env-refresh.service
systemctl enable scenario6-worker.service

echo "[INFO] Scenario 6 Worker VM setup complete. Deploy app code and .env, then: systemctl start scenario6-worker"
