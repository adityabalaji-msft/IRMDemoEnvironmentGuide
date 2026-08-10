#!/bin/bash
set -e

echo "=== Removing unsupported kernel boot files ==="

# Remove boot files for unsupported kernels (keep 5.15.0-1118-azure)
rm -f /boot/vmlinuz-6.8.0-1064-azure /boot/initrd.img-6.8.0-1064-azure
rm -f /boot/vmlinuz-6.2.0-1019-azure /boot/initrd.img-6.2.0-1019-azure

# Update grub so only 5.15.0-1118-azure is bootable
update-grub

echo "=== Remaining kernels in /boot: ==="
ls /boot/vmlinuz-* 2>/dev/null

# Hold to prevent kernel upgrades
apt-mark hold linux-image-azure-lts-22.04 linux-modules-extra-azure-lts-22.04 2>/dev/null || true

echo "=== Done - ready for reboot ==="
