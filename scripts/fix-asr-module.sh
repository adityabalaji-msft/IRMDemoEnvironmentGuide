#!/bin/bash
# Fix ASR involflt kernel module and make it persist across reboots
set -e

echo "=== Current kernel ==="
uname -r

echo "=== Current module status ==="
lsmod | grep involflt && echo "Module IS loaded" || echo "Module NOT loaded"

echo "=== Running hotfix installer ==="
cd /root/asr-drivers
./hotfix_install.sh /root/asr-drivers/ 2>&1 | tail -5

echo "=== Setting up boot persistence ==="
# Find the module file the hotfix installed
KERN=$(uname -r)
ASR_MOD=$(find /usr/local/ASR/Vx/transport/Drivers/ -name "involflt.ko.*" -type f 2>/dev/null | head -1)
if [ -z "$ASR_MOD" ]; then
  ASR_MOD=$(find /root/asr-drivers/Drivers/ -name "involflt.ko.$KERN" -type f 2>/dev/null | head -1)
fi

if [ -n "$ASR_MOD" ]; then
  echo "Found ASR module: $ASR_MOD"
  mkdir -p /lib/modules/$KERN/extra
  cp "$ASR_MOD" /lib/modules/$KERN/extra/involflt.ko
  depmod -a
  echo "involflt" > /etc/modules-load.d/involflt.conf
  echo "Module copied to /lib/modules/$KERN/extra/involflt.ko"
else
  echo "WARNING: Could not find involflt module file for persistence"
fi

# Also create a systemd service as a backup to reload the module on boot
cat > /etc/systemd/system/asr-involflt.service << 'EOF'
[Unit]
Description=Load ASR involflt kernel module
After=local-fs.target
Before=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'if ! lsmod | grep -q involflt; then cd /root/asr-drivers && ./hotfix_install.sh /root/asr-drivers/ > /var/log/asr-involflt-reload.log 2>&1; fi'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable asr-involflt.service
echo "Systemd service asr-involflt.service enabled"

echo "=== Final verification ==="
lsmod | grep involflt
ls -la /dev/involflt 2>/dev/null || echo "/dev/involflt not present (will be created by ASR)"
cat /etc/modules-load.d/involflt.conf
systemctl is-enabled asr-involflt.service
echo "=== DONE ==="
