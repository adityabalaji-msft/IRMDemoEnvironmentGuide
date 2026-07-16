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

systemctl daemon-reload
systemctl enable scenario6-worker.service

echo "[INFO] Scenario 6 Worker VM setup complete. Deploy app code and .env, then: systemctl start scenario6-worker"
