// =============================================================================
// Scenario 6-ASR: Zone-Pinned VM with Azure Site Recovery
// =============================================================================
// Combined frontend + backend running on a VM protected by ASR zone-to-zone
// replication. Points to: zr-vm-asr-vm, zr-vm-asr-worker, ASR vault zr-vm-asr-rsv
//
// 🎯 SIGNALS:
//    - VM protected by ASR (zone 1 → zone 2 replication)
//    - After failover: IMDS refreshes zone, post-failover script fixes DNS/IP
//    - SQL_SERVER, STORAGE_ACCOUNT_URL set via .env on VM
//
// 🟡 RISK: MEDIUM — ASR provides zone DR, but failover is manual (~RTO 15-30min)
// =============================================================================

require('dotenv').config();

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

const appInsights = require('applicationinsights');

appInsights
  .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectExceptions(true)
  .setSendLiveMetrics(true)
  .start();

const express = require('express');
const sql = require('mssql');
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const os = require('os');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCENARIO = 'scenario6-vm-asr';
let VM_ZONE = process.env.VM_ZONE || 'unknown';
const VM_NAME = process.env.VM_NAME || os.hostname();

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
      console.log(`[IMDS] Detected zone: ${VM_ZONE}`);
    }
  } catch {
    // IMDS not available — keep env var value
  }
}
refreshZoneFromIMDS();

// --- SQL Config (Entra or password auth) ---
const USE_ENTRA_AUTH = (process.env.SQL_AUTH_TYPE || '').toLowerCase() === 'entra';

let credential;
if (USE_ENTRA_AUTH) {
  const { DefaultAzureCredential } = require('@azure/identity');
  credential = new DefaultAzureCredential();
}

async function getSqlConfig() {
  if (USE_ENTRA_AUTH) {
    const tokenResponse = await credential.getToken('https://database.windows.net/.default');
    return {
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      authentication: {
        type: 'azure-active-directory-access-token',
        options: { token: tokenResponse.token },
      },
      options: { encrypt: true, trustServerCertificate: false, requestTimeout: 5000, connectionTimeout: 5000 },
    };
  } else {
    return {
      user: process.env.SQL_USER || 'sqladmin',
      password: process.env.SQL_PASSWORD,
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      options: { encrypt: true, trustServerCertificate: false, requestTimeout: 5000, connectionTimeout: 5000 },
    };
  }
}

// --- Storage Config ---
const STORAGE_URL = process.env.STORAGE_ACCOUNT_URL;
const STORAGE_ACCOUNT_NAME = process.env.STORAGE_ACCOUNT_NAME;
const STORAGE_ACCOUNT_KEY = process.env.STORAGE_ACCOUNT_KEY;

let storageClient = null;
if (STORAGE_URL && STORAGE_ACCOUNT_NAME && STORAGE_ACCOUNT_KEY) {
  const sharedKeyCred = new StorageSharedKeyCredential(STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY);
  storageClient = new BlobServiceClient(STORAGE_URL, sharedKeyCred);
} else if (STORAGE_URL && credential) {
  storageClient = new BlobServiceClient(STORAGE_URL, credential);
} else if (STORAGE_URL) {
  storageClient = new BlobServiceClient(STORAGE_URL);
}

// =============================================================================
// HTML Landing Page
// =============================================================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zava Inventory - ASR Protected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #1a1a2e; min-height: 100vh; }
    .navbar { background: #1a1a2e; padding: 0 2rem; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .nav-brand { display: flex; align-items: center; gap: 0.75rem; }
    .nav-brand h1 { color: #fff; font-size: 1.3rem; font-weight: 700; }
    .nav-brand .logo { width: 32px; height: 32px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; }
    .nav-links a { color: #b8c0cc; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; cursor: pointer; }
    .nav-links a:hover { color: #fff; }
    .nav-links a.active { color: #10b981; font-weight: 600; }
    .admin-btn { background: transparent; color: #8b949e; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
    .admin-btn:hover { border-color: #10b981; color: #10b981; }
    .status-bar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 0.5rem 2rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; }
    .status-bar .status-left { display: flex; gap: 1.5rem; align-items: center; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .status-dot.green { background: #10b981; }
    .status-dot.red { background: #ef4444; animation: pulse 1.5s infinite; }
    .status-dot.yellow { background: #f59e0b; }
    .zone-tag { background: #dbeafe; color: #1e40af; padding: 2px 10px; border-radius: 12px; font-weight: 500; }
    .asr-tag { background: #dcfce7; color: #166534; padding: 2px 10px; border-radius: 12px; font-weight: 500; margin-left: 8px; }
    .rg-tag { background: #fef3c7; color: #92400e; padding: 2px 10px; border-radius: 12px; font-weight: 500; margin-left: 8px; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .hero { background: linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%); padding: 2.5rem 2rem; text-align: center; color: #fff; }
    .hero h2 { font-size: 2rem; margin-bottom: 0.5rem; }
    .hero p { color: #a7f3d0; font-size: 1rem; max-width: 700px; margin: 0 auto; }
    .hero-badges { display: flex; gap: 0.75rem; justify-content: center; margin-top: 1.2rem; flex-wrap: wrap; }
    .hero-badge { background: rgba(16,185,129,0.2); border: 1px solid rgba(16,185,129,0.4); padding: 5px 12px; border-radius: 20px; font-size: 0.75rem; color: #6ee7b7; }
    .main { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; text-align: center; }
    .stat-card .stat-value { font-size: 2rem; font-weight: 700; color: #1a1a2e; }
    .stat-card .stat-label { font-size: 0.8rem; color: #64748b; margin-top: 4px; }
    .stat-card.warn .stat-value { color: #f59e0b; }
    .stat-card.danger .stat-value { color: #ef4444; }
    .stat-card.asr .stat-value { color: #10b981; }
    .inv-table-wrap { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; margin-bottom: 2rem; overflow-x: auto; }
    .inv-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .inv-table th { text-align: left; padding: 0.75rem 1rem; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; }
    .inv-table td { padding: 0.75rem 1rem; border-bottom: 1px solid #f1f5f9; }
    .inv-table tr:hover { background: #f8fafc; }
    .sku-code { font-family: monospace; color: #059669; font-weight: 600; font-size: 0.85rem; }
    .stock-badge { padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .stock-badge.in-stock { background: #dcfce7; color: #166534; }
    .stock-badge.low-stock { background: #fef3c7; color: #92400e; }
    .stock-badge.out-of-stock { background: #fee2e2; color: #991b1b; }
    .action-btn { background: #059669; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; margin-right: 4px; transition: background 0.2s; }
    .action-btn:hover { background: #047857; }
    .action-btn.restock { background: #2563eb; }
    .action-btn.restock:hover { background: #1d4ed8; }
    .activity-section { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .activity-item { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem; }
    .activity-item:last-child { border-bottom: none; }
    .activity-type { padding: 3px 8px; border-radius: 8px; font-size: 0.7rem; font-weight: 600; }
    .activity-type.order { background: #dbeafe; color: #1e40af; }
    .activity-type.sync { background: #ede9fe; color: #5b21b6; }
    .activity-type.restock { background: #dcfce7; color: #166534; }
    .activity-type.alert { background: #fee2e2; color: #991b1b; }
    .toast { position: fixed; bottom: 2rem; right: 2rem; background: #1a1a2e; color: #fff; padding: 12px 20px; border-radius: 10px; font-size: 0.9rem; z-index: 3000; display: none; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
    .toast.show { display: flex; align-items: center; gap: 8px; animation: slideUp 0.3s ease; }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .admin-panel { display: none; position: fixed; top: 64px; left: 0; right: 0; bottom: 0; background: #0f1117; z-index: 1500; overflow-y: auto; padding: 2rem; color: #e1e4e8; }
    .admin-panel.open { display: block; }
    .admin-panel h2 { color: #10b981; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .admin-close { position: absolute; top: 1rem; right: 2rem; background: none; border: 1px solid #30363d; color: #8b949e; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
    .admin-close:hover { border-color: #10b981; color: #10b981; }
    .admin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .admin-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; }
    .admin-card h4 { color: #10b981; margin-bottom: 0.75rem; font-size: 1rem; }
    .admin-card .dep-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
    .admin-card .dep-row:last-child { border-bottom: none; }
    .admin-card .dep-label { color: #8b949e; }
    .admin-card .dep-value { color: #e1e4e8; font-family: monospace; font-size: 0.8rem; }
    .zone-viz { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
    .zone-box { border-radius: 12px; padding: 1.5rem; text-align: center; }
    .zone-box.active { background: #0d1f0d; border: 2px solid #238636; }
    .zone-box.standby { background: #161b22; border: 2px dashed #30363d; }
    .zone-box h4 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    .zone-box .zone-status-text { font-size: 0.8rem; margin-top: 0.5rem; }
    .zone-box .vm-list { margin-top: 0.75rem; font-size: 0.8rem; text-align: left; }
    .zone-box .vm-item { display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid #21262d; }
    .admin-log { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 0.75rem; max-height: 280px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; margin-top: 1rem; }
    .admin-log .event { padding: 3px 0; border-bottom: 1px solid #21262d11; }
    .admin-log .event.warn { color: #d29922; }
    .admin-log .event.error { color: #f85149; }
    .admin-log .event.ok { color: #3fb950; }
    .admin-log .event.info { color: #58a6ff; }
    .footer { background: #1a1a2e; color: #8b949e; padding: 1.5rem 2rem; text-align: center; font-size: 0.8rem; margin-top: 2rem; }
    .footer a { color: #10b981; text-decoration: none; }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="nav-brand">
      <div class="logo">&#128737;</div>
      <h1>Zava Inventory <span style="font-size:0.7rem;color:#10b981;margin-left:6px;">ASR</span></h1>
    </div>
    <div class="nav-links">
      <a class="active" onclick="showMain()">Inventory</a>
      <a onclick="showOrders()">Orders</a>
      <a onclick="showSync()">Data Sync</a>
      <button class="admin-btn" onclick="toggleAdmin()">&#9881; Admin Panel</button>
    </div>
  </nav>

  <div class="status-bar">
    <div class="status-left">
      <span><span class="status-dot green" id="sql-dot"></span> SQL Database</span>
      <span><span class="status-dot green" id="storage-dot"></span> Blob Storage</span>
      <span><span class="status-dot green" id="worker-dot"></span> Worker VM</span>
    </div>
    <div>
      <span class="zone-tag" id="zone-tag">Zone ${VM_ZONE}</span>
      <span class="asr-tag">ASR Protected</span>
      <span class="rg-tag">zr-demo-vm-asr-rg</span>
    </div>
  </div>

  <section class="hero">
    <h2>Inventory Management System</h2>
    <p>ASR-protected inventory app on zone-pinned VM with zone-to-zone disaster recovery (Zone 1 &rarr; Zone 2)</p>
    <div class="hero-badges">
      <span class="hero-badge">ASR Zone-to-Zone DR</span>
      <span class="hero-badge">RG: zr-demo-vm-asr-rg</span>
      <span class="hero-badge">Recovery RG: zr-demo-vm-asr-recovery-rg</span>
      <span class="hero-badge">Vault: zr-vm-asr-rsv</span>
      <span class="hero-badge">Worker VM (Data Sync)</span>
    </div>
  </section>

  <main class="main">
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card"><div class="stat-value" id="stat-products">--</div><div class="stat-label">Products</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-orders">--</div><div class="stat-label">Orders Today</div></div>
      <div class="stat-card warn"><div class="stat-value" id="stat-low">--</div><div class="stat-label">Low Stock Items</div></div>
      <div class="stat-card asr"><div class="stat-value" id="stat-asr">Protected</div><div class="stat-label">ASR Status</div></div>
    </div>

    <div class="inv-table-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h2 style="font-size:1.4rem;">Product Inventory</h2>
        <button class="action-btn" onclick="refreshInventory()">&#8635; Refresh</button>
      </div>
      <table class="inv-table">
        <thead><tr><th>SKU</th><th>Product Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="inv-body"><tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem;">Loading inventory...</td></tr></tbody>
      </table>
    </div>

    <div class="activity-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h2 style="font-size:1.4rem;">Recent Activity</h2>
        <span style="font-size:0.8rem;color:#94a3b8;">Auto-refreshes every 10s</span>
      </div>
      <div id="activity-list">
        <div style="text-align:center;color:#94a3b8;padding:1rem;">Loading activity...</div>
      </div>
    </div>
  </main>

  <div class="admin-panel" id="admin-panel">
    <button class="admin-close" onclick="toggleAdmin()">&#10005; Close</button>
    <h2>&#9881; Infrastructure &amp; ASR Status</h2>

    <h3 style="color:#10b981; margin-bottom:1rem;">Availability Zone Layout (ASR Replication)</h3>
    <div class="zone-viz">
      <div class="zone-box active">
        <h4>&#128994; Zone ${VM_ZONE} (Active)</h4>
        <div class="zone-status-text" style="color:#3fb950;">SERVING TRAFFIC</div>
        <div class="vm-list">
          <div class="vm-item"><span>zr-vm-asr-vm</span><span style="color:#3fb950;">Running</span></div>
          <div class="vm-item"><span>zr-vm-asr-worker</span><span style="color:#3fb950;">Running</span></div>
        </div>
      </div>
      <div class="zone-box standby">
        <h4>&#11036; Zone ${VM_ZONE === '1' ? '2' : '1'} (DR Target)</h4>
        <div class="zone-status-text" style="color:#8b949e;">ASR REPLICATION TARGET</div>
        <div class="vm-list">
          <div class="vm-item"><span>zr-vm-asr-vm (replica)</span><span style="color:#8b949e;">Standby</span></div>
          <div class="vm-item"><span>zr-vm-asr-worker (replica)</span><span style="color:#8b949e;">Standby</span></div>
        </div>
      </div>
    </div>

    <div class="admin-grid">
      <div class="admin-card">
        <h4>&#128187; Main VM — zr-vm-asr-vm</h4>
        <div class="dep-row"><span class="dep-label">VM Name</span><span class="dep-value">${VM_NAME}</span></div>
        <div class="dep-row"><span class="dep-label">Zone</span><span class="dep-value" id="admin-zone">${VM_ZONE}</span></div>
        <div class="dep-row"><span class="dep-label">Resource Group</span><span class="dep-value">zr-demo-vm-asr-rg</span></div>
        <div class="dep-row"><span class="dep-label">Hostname</span><span class="dep-value">${os.hostname()}</span></div>
        <div class="dep-row"><span class="dep-label">Port</span><span class="dep-value">${PORT}</span></div>
        <div class="dep-row"><span class="dep-label">ASR Vault</span><span class="dep-value">zr-vm-asr-rsv</span></div>
        <div class="dep-row"><span class="dep-label">ASR Status</span><span class="dep-value" style="color:#3fb950;">Protected (Zone 1 → Zone 2)</span></div>
        <div class="dep-row"><span class="dep-label">Recovery RG</span><span class="dep-value">zr-demo-vm-asr-recovery-rg</span></div>
      </div>
      <div class="admin-card">
        <h4>&#128736; Worker VM — zr-vm-asr-worker</h4>
        <div class="dep-row"><span class="dep-label">URL</span><span class="dep-value">${process.env.WORKER_VM_URL || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Zone</span><span class="dep-value">${VM_ZONE}</span></div>
        <div class="dep-row"><span class="dep-label">Role</span><span class="dep-value">Background data sync</span></div>
        <div class="dep-row"><span class="dep-label">Status</span><span class="dep-value" id="admin-worker-status">Checking...</span></div>
        <div class="dep-row"><span class="dep-label">ASR Status</span><span class="dep-value" style="color:#3fb950;">Protected (Zone 1 → Zone 2)</span></div>
        <div class="dep-row"><span class="dep-label">Sync Count</span><span class="dep-value" id="admin-sync-count">--</span></div>
      </div>
      <div class="admin-card">
        <h4>&#128450; Azure SQL Database</h4>
        <div class="dep-row"><span class="dep-label">Server</span><span class="dep-value">${process.env.SQL_SERVER || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Database</span><span class="dep-value">${process.env.SQL_DATABASE || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Auth Type</span><span class="dep-value">${USE_ENTRA_AUTH ? 'Entra ID (Managed Identity)' : 'SQL Password'}</span></div>
        <div class="dep-row"><span class="dep-label">Status</span><span class="dep-value" id="admin-sql-status">Checking...</span></div>
      </div>
      <div class="admin-card">
        <h4>&#128193; Azure Blob Storage</h4>
        <div class="dep-row"><span class="dep-label">Account URL</span><span class="dep-value">${STORAGE_URL || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Account Name</span><span class="dep-value">${STORAGE_ACCOUNT_NAME || 'NOT SET'}</span></div>
        <div class="dep-row"><span class="dep-label">Status</span><span class="dep-value" id="admin-storage-status">Checking...</span></div>
      </div>
      <div class="admin-card">
        <h4>&#128737; ASR Configuration</h4>
        <div class="dep-row"><span class="dep-label">Vault</span><span class="dep-value">zr-vm-asr-rsv</span></div>
        <div class="dep-row"><span class="dep-label">Fabric</span><span class="dep-value">westus2-fabric</span></div>
        <div class="dep-row"><span class="dep-label">Source Container</span><span class="dep-value">westus2-source-container</span></div>
        <div class="dep-row"><span class="dep-label">Target Container</span><span class="dep-value">westus2-target-container</span></div>
        <div class="dep-row"><span class="dep-label">Policy</span><span class="dep-value">zr-vm-asr-repl-policy</span></div>
        <div class="dep-row"><span class="dep-label">Source Zone</span><span class="dep-value">1</span></div>
        <div class="dep-row"><span class="dep-label">Target Zone</span><span class="dep-value">2</span></div>
        <div class="dep-row"><span class="dep-label">Multi-VM Group</span><span class="dep-value">scenario6-asr-group</span></div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem;">
      <h3 style="color:#10b981;">Activity Log</h3>
      <button onclick="clearActivityLog()" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">Clear</button>
    </div>
    <div class="admin-log" id="admin-log"></div>
  </div>

  <div class="toast" id="toast"></div>

  <div class="footer">
    <p>Zava Inventory (ASR) &mdash; VM: <strong>${VM_NAME}</strong> &middot; Zone <strong>${VM_ZONE}</strong> &middot; DR Target: Zone ${VM_ZONE === '1' ? '2' : '1'} &middot; RG: zr-demo-vm-asr-rg &middot; <a href="/health">Health</a> &middot; <a href="/dependencies">Dependencies</a></p>
  </div>

  <script>
    const inventory = [
      { sku: 'ASR-001', name: 'Industrial Servo Motor', category: 'Motors', price: 249.99, stock: 85 },
      { sku: 'ASR-002', name: 'Precision Ball Bearing (10-pack)', category: 'Bearings', price: 34.99, stock: 312 },
      { sku: 'ASR-003', name: 'Hydraulic Cylinder 150mm', category: 'Hydraulics', price: 189.50, stock: 12 },
      { sku: 'ASR-004', name: 'PLC Controller Module', category: 'Electronics', price: 599.00, stock: 45 },
      { sku: 'ASR-005', name: 'Stainless Steel Valve DN50', category: 'Valves', price: 78.25, stock: 0 },
      { sku: 'ASR-006', name: 'Conveyor Belt Segment 2m', category: 'Conveyors', price: 425.00, stock: 8 },
      { sku: 'ASR-007', name: 'Safety Light Curtain', category: 'Safety', price: 892.00, stock: 23 },
      { sku: 'ASR-008', name: 'Pneumatic Air Filter', category: 'Pneumatics', price: 45.99, stock: 156 },
      { sku: 'ASR-009', name: 'Temperature Sensor PT100', category: 'Sensors', price: 29.99, stock: 4 },
      { sku: 'ASR-010', name: 'Electric Actuator 24V', category: 'Actuators', price: 345.00, stock: 67 },
    ];

    let recentActivities = [];
    let activityLog = JSON.parse(localStorage.getItem('asr_activity_log') || '[]');
    let previousHealth = JSON.parse(localStorage.getItem('asr_prev_health') || 'null');

    function renderInventory() {
      const body = document.getElementById('inv-body');
      body.innerHTML = inventory.map(item => {
        let statusCls = 'in-stock', statusText = 'In Stock';
        if (item.stock === 0) { statusCls = 'out-of-stock'; statusText = 'Out of Stock'; }
        else if (item.stock < 15) { statusCls = 'low-stock'; statusText = 'Low Stock'; }
        return '<tr><td class="sku-code">' + item.sku + '</td><td>' + item.name + '</td><td>' + item.category + '</td><td>$' + item.price.toFixed(2) + '</td><td><strong>' + item.stock + '</strong></td><td><span class="stock-badge ' + statusCls + '">' + statusText + '</span></td><td><button class="action-btn" onclick="placeOrder(\\'' + item.sku + '\\')">Order</button><button class="action-btn restock" onclick="restockItem(\\'' + item.sku + '\\')">Restock</button></td></tr>';
      }).join('');
      document.getElementById('stat-products').textContent = inventory.length;
      document.getElementById('stat-low').textContent = inventory.filter(i => i.stock > 0 && i.stock < 15).length;
    }

    function refreshInventory() {
      fetch('/api/products').then(r => r.json()).then(data => {
        if (data.products) { document.getElementById('stat-products').textContent = data.products.length; showToast('&#10003; Inventory refreshed from SQL'); }
      }).catch(() => showToast('&#10060; Failed to refresh from SQL'));
      renderInventory();
    }

    function placeOrder(sku) {
      const item = inventory.find(i => i.sku === sku);
      if (!item || item.stock === 0) { showToast('&#10060; Item out of stock'); return; }
      item.stock -= 1;
      const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();
      recentActivities.unshift({ type: 'order', msg: 'Order ' + orderId + ': ' + item.name, time: new Date() });
      addLogEvent('Order placed: ' + orderId + ' - ' + item.name, 'info');
      renderInventory(); renderActivity();
      showToast('&#10003; Order ' + orderId + ' placed');
      fetch('/api/orders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({customerId:'web-user', productId:1, quantity:1}) }).catch(() => {});
      document.getElementById('stat-orders').textContent = recentActivities.filter(a => a.type === 'order').length;
    }

    function restockItem(sku) {
      const item = inventory.find(i => i.sku === sku);
      if (!item) return;
      const qty = Math.floor(Math.random() * 50) + 20;
      item.stock += qty;
      recentActivities.unshift({ type: 'restock', msg: 'Restocked ' + item.name + ': +' + qty + ' units', time: new Date() });
      addLogEvent('Restock: ' + item.name + ' +' + qty, 'ok');
      renderInventory(); renderActivity();
      showToast('&#10003; Restocked ' + item.name);
    }

    function showOrders() { document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active')); event.target.classList.add('active'); }
    function showSync() { document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active')); event.target.classList.add('active'); }
    function showMain() { document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active')); event.target.classList.add('active'); }

    function renderActivity() {
      const el = document.getElementById('activity-list');
      if (recentActivities.length === 0) { el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:1rem;">No activity yet</div>'; return; }
      el.innerHTML = recentActivities.slice(0, 8).map(a => {
        const ago = Math.round((Date.now() - new Date(a.time).getTime()) / 1000);
        const timeStr = ago < 60 ? ago + 's ago' : Math.round(ago/60) + 'm ago';
        return '<div class="activity-item"><span><span class="activity-type ' + a.type + '">' + a.type.toUpperCase() + '</span> ' + a.msg + '</span><span style="color:#94a3b8;font-size:0.8rem;">' + timeStr + '</span></div>';
      }).join('');
    }

    async function pollHealth() {
      try {
        const r = await fetch('/admin-status');
        const d = await r.json();
        document.getElementById('sql-dot').className = 'status-dot ' + (d.sql.ok ? 'green' : 'red');
        document.getElementById('storage-dot').className = 'status-dot ' + (d.storage.ok ? 'green' : 'red');
        document.getElementById('worker-dot').className = 'status-dot ' + (d.worker.ok ? 'green' : 'yellow');
        document.getElementById('zone-tag').textContent = 'Zone ' + d.zone;
        document.getElementById('admin-zone').textContent = d.zone;
        document.getElementById('admin-sql-status').innerHTML = d.sql.ok ? '<span style="color:#3fb950;">Connected</span>' : '<span style="color:#f85149;">Unreachable</span>';
        document.getElementById('admin-storage-status').innerHTML = d.storage.ok ? '<span style="color:#3fb950;">Connected (' + d.storage.blobs + ' blobs)</span>' : '<span style="color:#f85149;">Unreachable</span>';
        document.getElementById('admin-worker-status').innerHTML = d.worker.ok ? '<span style="color:#3fb950;">Healthy</span>' : '<span style="color:#f85149;">Unreachable</span>';
        if (d.worker.ok) { document.getElementById('admin-sync-count').textContent = d.worker.syncCount; }
        detectHealthChanges(d);
        previousHealth = d;
        localStorage.setItem('asr_prev_health', JSON.stringify(d));
      } catch (err) { document.getElementById('sql-dot').className = 'status-dot red'; }
    }

    function detectHealthChanges(curr) {
      if (!previousHealth) { addLogEvent('System started - Zone ' + curr.zone + ', VM: ' + curr.vm, 'ok'); return; }
      if (previousHealth.zone !== curr.zone) {
        addLogEvent('FAILOVER DETECTED: Zone changed ' + previousHealth.zone + ' → ' + curr.zone, 'error');
        addLogEvent('ASR failover completed - now serving from Zone ' + curr.zone, 'warn');
      }
      if (previousHealth.sql.ok && !curr.sql.ok) addLogEvent('SQL Database: LOST', 'error');
      if (!previousHealth.sql.ok && curr.sql.ok) addLogEvent('SQL Database: RESTORED', 'ok');
      if (previousHealth.storage.ok && !curr.storage.ok) addLogEvent('Blob Storage: LOST', 'error');
      if (!previousHealth.storage.ok && curr.storage.ok) addLogEvent('Blob Storage: RESTORED', 'ok');
      if (previousHealth.worker.ok && !curr.worker.ok) addLogEvent('Worker VM: UNREACHABLE', 'error');
      if (!previousHealth.worker.ok && curr.worker.ok) addLogEvent('Worker VM: RESTORED', 'ok');
    }

    function addLogEvent(msg, level) {
      const now = new Date();
      const ts = now.toLocaleDateString('en-US', {month:'short',day:'numeric'}) + ' ' + now.toLocaleTimeString();
      activityLog.unshift({ ts, msg, level, epoch: now.getTime() });
      if (activityLog.length > 200) activityLog = activityLog.slice(0, 200);
      localStorage.setItem('asr_activity_log', JSON.stringify(activityLog));
      renderLog();
    }

    function clearActivityLog() { activityLog = []; localStorage.removeItem('asr_activity_log'); localStorage.removeItem('asr_prev_health'); previousHealth = null; renderLog(); }

    function renderLog() {
      const el = document.getElementById('admin-log');
      if (!el) return;
      if (activityLog.length === 0) { el.innerHTML = '<div style="color:#8b949e;padding:0.5rem;">No events yet.</div>'; return; }
      el.innerHTML = activityLog.map(e => '<div class="event ' + e.level + '">[' + e.ts + '] ' + e.msg + '</div>').join('');
    }

    function toggleAdmin() { document.getElementById('admin-panel').classList.toggle('open'); if (document.getElementById('admin-panel').classList.contains('open')) { pollHealth(); } }
    function showToast(msg) { const t = document.getElementById('toast'); t.innerHTML = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }

    renderInventory(); renderActivity(); renderLog(); pollHealth();
    document.getElementById('stat-orders').textContent = '0';
    setInterval(pollHealth, 10000);
  </script>
</body>
</html>`);
});

// =============================================================================
// API Endpoints
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'vm-asr-app',
    scenario: SCENARIO,
    vm: VM_NAME,
    zone: VM_ZONE,
    hostname: os.hostname(),
    resourceGroup: 'zr-demo-vm-asr-rg',
    recoveryRG: 'zr-demo-vm-asr-recovery-rg',
    asrVault: 'zr-vm-asr-rsv',
    timestamp: new Date().toISOString(),
    config: {
      sqlServer: process.env.SQL_SERVER || 'NOT SET',
      sqlAuthType: USE_ENTRA_AUTH ? 'entra' : 'sql-password',
      storageUrl: STORAGE_URL || 'NOT SET',
    },
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query(`
      IF OBJECT_ID('dbo.Products', 'U') IS NULL
        CREATE TABLE dbo.Products (Id INT IDENTITY(1,1) PRIMARY KEY, Name VARCHAR(100), Price DECIMAL(10,2), Stock INT);
      IF NOT EXISTS (SELECT 1 FROM dbo.Products)
        INSERT INTO dbo.Products (Name, Price, Stock) VALUES ('Widget A', 9.99, 100), ('Widget B', 19.99, 50), ('Widget C', 4.99, 200);
    `);
    const result = await pool.request().query('SELECT * FROM dbo.Products');
    res.json({ products: result.recordset, source: 'vm-asr-sql', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, productId = 1, quantity = 1 } = req.body || {};
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query(`
      IF OBJECT_ID('dbo.VmOrders', 'U') IS NULL
        CREATE TABLE dbo.VmOrders (Id INT IDENTITY(1,1) PRIMARY KEY, CustomerId VARCHAR(100), ProductId INT, Quantity INT, CreatedAt DATETIME DEFAULT GETDATE());
    `);
    const result = await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('productId', sql.Int, productId)
      .input('quantity', sql.Int, quantity)
      .query('INSERT INTO dbo.VmOrders (CustomerId, ProductId, Quantity) OUTPUT INSERTED.Id VALUES (@customerId, @productId, @quantity)');
    res.status(201).json({ orderId: result.recordset[0].Id, customerId, productId, quantity, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/assets', async (req, res) => {
  if (!storageClient) return res.status(503).json({ error: 'Storage not configured' });
  try {
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat({ maxPageSize: 10 })) { blobs.push(blob.name); }
    res.json({ assets: blobs, storageUrl: STORAGE_URL, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'vm-asr-app',
    riskLevel: 'MEDIUM',
    vmName: VM_NAME,
    vmZone: VM_ZONE,
    resourceGroup: 'zr-demo-vm-asr-rg',
    recoveryResourceGroup: 'zr-demo-vm-asr-recovery-rg',
    asrVault: 'zr-vm-asr-rsv',
    note: 'ASR-protected inventory app with zone-to-zone DR. Failover RTO ~15-30min.',
    dependencies: [
      { type: 'AzureSQLDatabase', envVar: 'SQL_SERVER', value: process.env.SQL_SERVER || 'NOT SET' },
      { type: 'AzureBlobStorage', envVar: 'STORAGE_ACCOUNT_URL', value: STORAGE_URL || 'NOT SET' },
      { type: 'WorkerVM', envVar: 'WORKER_VM_URL', value: process.env.WORKER_VM_URL || 'NOT SET' },
      { type: 'ASRVault', value: 'zr-vm-asr-rsv', fabric: 'westus2-fabric' },
    ],
  });
});

app.get('/admin-status', async (req, res) => {
  let sqlStatus = { ok: false };
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query('SELECT 1 AS ok');
    sqlStatus = { ok: true };
  } catch (err) { sqlStatus = { ok: false, error: err.message }; }

  let storageStatus = { ok: false, blobs: 0 };
  if (storageClient) {
    try {
      const containerClient = storageClient.getContainerClient('demo-data');
      let count = 0;
      for await (const blob of containerClient.listBlobsFlat({ maxPageSize: 10 })) { count++; }
      storageStatus = { ok: true, blobs: count };
    } catch (err) { storageStatus = { ok: false, error: err.message, blobs: 0 }; }
  }

  let workerStatus = { ok: false, syncCount: 0, recordsProcessed: 0 };
  const workerUrl = process.env.WORKER_VM_URL;
  if (workerUrl) {
    try {
      const http = require('http');
      const workerData = await new Promise((resolve, reject) => {
        const req = http.get(`${workerUrl}/health`, { timeout: 3000 }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      workerStatus = { ok: true, syncCount: workerData.syncState?.syncCount || 0, recordsProcessed: workerData.syncState?.recordsProcessed || 0 };
    } catch (err) { workerStatus = { ok: false, error: err.message, syncCount: 0, recordsProcessed: 0 }; }
  }

  res.json({ vm: VM_NAME, zone: VM_ZONE, timestamp: new Date().toISOString(), sql: sqlStatus, storage: storageStatus, worker: workerStatus });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] ASR-Protected VM App listening on port ${PORT}`);
  console.log(`VM:          ${VM_NAME}`);
  console.log(`Zone:        ${VM_ZONE}`);
  console.log(`RG:          zr-demo-vm-asr-rg`);
  console.log(`Recovery RG: zr-demo-vm-asr-recovery-rg`);
  console.log(`ASR Vault:   zr-vm-asr-rsv`);
  console.log(`SQL:         ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage:     ${STORAGE_URL || 'NOT SET'}`);
});
