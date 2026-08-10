import re

path = '/opt/scenario6-vm-zonal/src/index.js'
with open(path, 'r') as f:
    content = f.read()

content = content.replace('const VM_ZONE = process.env.VM_ZONE', 'let VM_ZONE = process.env.VM_ZONE')

imds_block = """
// --- IMDS Zone Detection (ASR failover support) ---
async function refreshZoneFromIMDS() {
  try {
    const http = require('http');
    const zone = await new Promise((resolve, reject) => {
      const req = http.get(
        'http://169.254.169.254/metadata/instance/compute/zone?api-version=2021-02-01&format=text',
        { headers: { 'Metadata': 'true' }, timeout: 2000 },
        (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => resolve(data.trim()));
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (zone && zone !== '') {
      VM_ZONE = zone;
      console.log('[IMDS] Detected zone: ' + VM_ZONE);
    }
  } catch (e) {
    // IMDS not available - keep env var value
  }
}
refreshZoneFromIMDS();
"""

marker = "const VM_NAME = process.env.VM_NAME || os.hostname();"
content = content.replace(marker, marker + imds_block)

with open(path, 'w') as f:
    f.write(content)

print('DONE')
print('refreshZoneFromIMDS count:', content.count('refreshZoneFromIMDS'))
print('let VM_ZONE count:', content.count('let VM_ZONE'))
