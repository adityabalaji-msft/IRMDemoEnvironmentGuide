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

systemctl daemon-reload
systemctl enable scenario6.service

echo "[INFO] Scenario 6 VM setup complete. Deploy app code and .env, then: systemctl start scenario6"
