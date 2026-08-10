#!/bin/bash
set -e

echo "=== Installing supported kernel for ASR ==="
apt-get update -qq

# Install the LTS 22.04 azure kernel (5.15.0 series)
apt-get install -y linux-image-azure-lts-22.04 linux-modules-extra-azure-lts-22.04

# Find which 5.15 kernel got installed
KERNEL=$(ls /boot/vmlinuz-5.15.0-*-azure 2>/dev/null | sort -V | tail -1 | sed 's|/boot/vmlinuz-||')
echo "Installed kernel: $KERNEL"

if [ -z "$KERNEL" ]; then
    echo "ERROR: No 5.15.0 azure kernel found in /boot"
    exit 1
fi

# Set GRUB to boot the installed kernel
sed -i "s/GRUB_DEFAULT=.*/GRUB_DEFAULT=\"Advanced options for Ubuntu>Ubuntu, with Linux $KERNEL\"/" /etc/default/grub
update-grub

echo "=== GRUB configured to boot $KERNEL ==="
echo "=== Reboot required ==="
