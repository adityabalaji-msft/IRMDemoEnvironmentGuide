// =============================================================================
// Scenario 6: Zone-Pinned VM — Single Instance App
// =============================================================================
// A combined frontend + backend running on a single VM pinned to one AZ.
// Connects to Azure SQL (Entra auth) and Azure Blob Storage (shared key).
//
// 🎯 SIGNALS:
//    - VM is pinned to a single availability zone — if that zone fails, app is DOWN
//    - SQL_SERVER and STORAGE_ACCOUNT_URL are set via VM environment / .env file
//    - No redundancy — single point of failure by design (demo: zone migration risk)
//
// 🔴 RISK: HIGH — zone-pinned single instance = total outage if zone fails
// =============================================================================

require('dotenv').config();

// Polyfill globalThis.crypto for Node.js < 19 compatibility
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
const SCENARIO = 'scenario6-vm-zonal';
const VM_ZONE = process.env.VM_ZONE || 'unknown';
const VM_NAME = process.env.VM_NAME || os.hostname();

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
        options: {
          token: tokenResponse.token,
        },
      },
      options: {
        encrypt: true,
        trustServerCertificate: false,
        requestTimeout: 5000,
        connectionTimeout: 5000,
      },
    };
  } else {
    return {
      user: process.env.SQL_USER || 'sqladmin',
      password: process.env.SQL_PASSWORD,
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        requestTimeout: 5000,
        connectionTimeout: 5000,
      },
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
} else if (STORAGE_URL) {
  storageClient = new BlobServiceClient(STORAGE_URL);
}

// =============================================================================
// HTML Landing Page
// =============================================================================
app.get('/', async (req, res) => {
  // Check SQL health
  let sqlStatus = { ok: false, detail: '' };
  try {
    const pool = await sql.connect(await getSqlConfig());
    const result = await pool.request().query('SELECT 1 AS ok');
    sqlStatus = { ok: true, detail: `SQL connected — ${process.env.SQL_SERVER}` };
  } catch (err) {
    sqlStatus = { ok: false, detail: err.message };
  }

  // Check storage health
  let storageStatus = { ok: false, detail: '' };
  if (storageClient) {
    try {
      const containerClient = storageClient.getContainerClient('demo-data');
      const blobs = [];
      for await (const blob of containerClient.listBlobsFlat({ maxPageSize: 3 })) {
        blobs.push(blob.name);
      }
      storageStatus = { ok: true, detail: `Found ${blobs.length} blob(s)` };
    } catch (err) {
      storageStatus = { ok: false, detail: err.message };
    }
  } else {
    storageStatus = { ok: false, detail: 'STORAGE_ACCOUNT_URL not configured' };
  }

  // Check worker VM health
  let workerStatus = { ok: false, detail: '' };
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
      workerStatus = { ok: true, detail: `Worker healthy — syncs: ${workerData.syncState.syncCount}, records: ${workerData.syncState.recordsProcessed}` };
    } catch (err) {
      workerStatus = { ok: false, detail: `Worker unreachable: ${err.message}` };
    }
  } else {
    workerStatus = { ok: false, detail: 'WORKER_VM_URL not configured' };
  }

  const allHealthy = sqlStatus.ok && storageStatus.ok && workerStatus.ok;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo — VM Based App Dashboard</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; padding: 2rem; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.8rem; color: #da3633; }
    .header p { color: #8b949e; margin-top: 0.5rem; }
    .zone-badge { display: inline-block; background: #da363333; border: 2px solid #da3633; color: #f85149;
      padding: 0.5rem 1.5rem; border-radius: 20px; font-size: 1.1rem; font-weight: bold; margin: 1rem 0;
      animation: glow 2s infinite; }
    @keyframes glow { 0%,100% { box-shadow: 0 0 10px #da363355; } 50% { box-shadow: 0 0 25px #da363388; } }
    .overall { text-align: center; padding: 1.5rem; border-radius: 12px; margin-bottom: 2rem;
      background: ${allHealthy ? '#0d1f0d' : '#2d0a0a'};
      border: 2px solid ${allHealthy ? '#238636' : '#da3633'}; }
    .overall h2 { font-size: 2rem; color: ${allHealthy ? '#3fb950' : '#f85149'}; }
    .overall p { color: #8b949e; margin-top: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; }
    .card.ok { border-left: 4px solid #3fb950; }
    .card.fail { border-left: 4px solid #f85149; }
    .card h3 { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .dot.green { background: #3fb950; box-shadow: 0 0 8px #3fb950; }
    .dot.red { background: #f85149; box-shadow: 0 0 8px #f85149; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .meta { font-size: 0.85rem; color: #8b949e; margin-bottom: 0.5rem; }
    .detail { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 1rem; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
    .endpoints { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; }
    .endpoints h3 { margin-bottom: 1rem; color: #58a6ff; }
    .endpoint { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #21262d; }
    .endpoint:last-child { border-bottom: none; }
    .endpoint a { color: #58a6ff; text-decoration: none; }
    .endpoint a:hover { text-decoration: underline; }
    .badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; }
    .badge.get { background: #1f6feb33; color: #58a6ff; }
    .badge.post { background: #3fb95033; color: #3fb950; }
    .vm-info { text-align: center; color: #484f58; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔴 Demo — VM Based App</h1>
    <p>Single Instance Dashboard</p>
    <div class="zone-badge">⚠️ PINNED TO ZONE ${VM_ZONE}</div>
  </div>

  <div class="overall">
    <h2>${allHealthy ? '✅ ALL SYSTEMS OPERATIONAL' : '🔴 DEGRADED — DEPENDENCY FAILURE DETECTED'}</h2>
    <p>${allHealthy ? 'All dependencies are reachable and healthy' : 'One or more dependencies are unreachable — see details below'}</p>
  </div>

  <div class="grid">
    <div class="card ${sqlStatus.ok ? 'ok' : 'fail'}">
      <h3><span class="dot ${sqlStatus.ok ? 'green' : 'red'}"></span> Azure SQL Database</h3>
      <div class="meta">
        <strong>Type:</strong> Azure SQL (external) &nbsp;|&nbsp;
        <strong>Source:</strong> VM environment variables
      </div>
      <div class="meta"><strong>Server:</strong> ${process.env.SQL_SERVER || 'NOT SET'}</div>
      <div class="meta"><strong>Auth:</strong> ${USE_ENTRA_AUTH ? 'Entra (DefaultAzureCredential)' : 'SQL Password'}</div>
      <div class="meta"><strong>Status:</strong> ${sqlStatus.ok ? '🟢 Connected' : '🔴 Unreachable'}</div>
      <div class="detail">${sqlStatus.detail}</div>
    </div>

    <div class="card ${storageStatus.ok ? 'ok' : 'fail'}">
      <h3><span class="dot ${storageStatus.ok ? 'green' : 'red'}"></span> Azure Blob Storage</h3>
      <div class="meta">
        <strong>Type:</strong> Azure Storage Account (external) &nbsp;|&nbsp;
        <strong>Source:</strong> VM environment variables
      </div>
      <div class="meta"><strong>URL:</strong> ${STORAGE_URL || 'NOT SET'}</div>
      <div class="meta"><strong>Status:</strong> ${storageStatus.ok ? '🟢 Connected' : '🔴 Unreachable'}</div>
      <div class="detail">${storageStatus.detail}</div>
    </div>

    <div class="card ${workerStatus.ok ? 'ok' : 'fail'}">
      <h3><span class="dot ${workerStatus.ok ? 'green' : 'red'}"></span> Worker VM — Data Sync Agent</h3>
      <div class="meta">
        <strong>Type:</strong> Background Worker (VM) &nbsp;|&nbsp;
        <strong>Zone:</strong> ${VM_ZONE}
      </div>
      <div class="meta"><strong>URL:</strong> ${workerUrl || 'NOT SET'}</div>
      <div class="meta"><strong>Status:</strong> ${workerStatus.ok ? '🟢 Connected' : '🔴 Unreachable'}</div>
      <div class="detail">${workerStatus.detail}</div>
    </div>
  </div>

  <div class="endpoints">
    <h3>📡 Available API Endpoints</h3>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/health">/health</a></span><span>Service health check</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/api/products">/api/products</a></span><span>Fetch products from SQL</span></div>
    <div class="endpoint"><span><span class="badge post">POST</span> /api/orders</span><span>Submit order to SQL</span></div>
    <div class="endpoint"><span><span class="badge post">POST</span> /api/loyalty</span><span>Check loyalty points</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/assets">/assets</a></span><span>List blobs in Azure Storage</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/dependencies">/dependencies</a></span><span>Dependency map (JSON)</span></div>
  </div>

  <div class="vm-info">
    VM: ${VM_NAME} &middot;
    Zone: ${VM_ZONE} &middot;
    Hostname: ${os.hostname()} &middot;
    Auto-refreshes every 10s &middot;
    ${new Date().toISOString()}
  </div>
</body>
</html>`);
});

// =============================================================================
// API Endpoints
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'vm-zonal-app',
    scenario: SCENARIO,
    vm: VM_NAME,
    zone: VM_ZONE,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    config: {
      sqlServer: process.env.SQL_SERVER || 'NOT SET',
      sqlAuthType: USE_ENTRA_AUTH ? 'entra' : 'sql-password',
      storageUrl: STORAGE_URL || 'NOT SET',
      configSource: 'vm-environment-variables',
    },
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query(`
      IF OBJECT_ID('dbo.Products', 'U') IS NULL
        CREATE TABLE dbo.Products (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name VARCHAR(100),
          Price DECIMAL(10,2),
          Stock INT
        );
      IF NOT EXISTS (SELECT 1 FROM dbo.Products)
        INSERT INTO dbo.Products (Name, Price, Stock) VALUES
          ('Widget A', 9.99, 100),
          ('Widget B', 19.99, 50),
          ('Widget C', 4.99, 200);
    `);
    const result = await pool.request().query('SELECT * FROM dbo.Products');
    res.json({ products: result.recordset, source: 'vm-direct-sql', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, hint: 'Check VM env vars for SQL_SERVER' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, productId = 1, quantity = 1 } = req.body || {};
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query(`
      IF OBJECT_ID('dbo.VmOrders', 'U') IS NULL
        CREATE TABLE dbo.VmOrders (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          CustomerId VARCHAR(100),
          ProductId INT,
          Quantity INT,
          CreatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    const result = await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('productId', sql.Int, productId)
      .input('quantity', sql.Int, quantity)
      .query(`
        INSERT INTO dbo.VmOrders (CustomerId, ProductId, Quantity)
        OUTPUT INSERTED.Id
        VALUES (@customerId, @productId, @quantity);
      `);
    const orderId = result.recordset[0].Id;
    res.status(201).json({ orderId, customerId, productId, quantity, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 10 } = req.body || {};
  try {
    const pool = await sql.connect(await getSqlConfig());
    await pool.request().query(`
      IF OBJECT_ID('dbo.VmLoyalty', 'U') IS NULL
        CREATE TABLE dbo.VmLoyalty (
          CustomerId VARCHAR(100) PRIMARY KEY,
          Points INT DEFAULT 0,
          UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .query(`
        MERGE dbo.VmLoyalty AS target
        USING (SELECT @customerId AS CustomerId, @points AS Points) AS source
        ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN UPDATE SET Points = target.Points + source.Points, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN INSERT (CustomerId, Points) VALUES (source.CustomerId, source.Points);
      `);
    res.json({ customerId, pointsAdded: points, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/assets', async (req, res) => {
  if (!storageClient) {
    return res.status(503).json({ error: 'STORAGE_ACCOUNT_URL/KEY not configured' });
  }
  try {
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat({ maxPageSize: 10 })) {
      blobs.push(blob.name);
    }
    res.json({ assets: blobs, storageUrl: STORAGE_URL, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, storageUrl: STORAGE_URL });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'vm-zonal-app',
    riskLevel: 'HIGH',
    vmName: VM_NAME,
    vmZone: VM_ZONE,
    note: 'Single VM pinned to one availability zone — total outage if zone fails. No load balancer, no redundancy.',
    dependencies: [
      {
        type: 'AzureSQLDatabase',
        configSource: 'vm_environment_variables',
        envVar: 'SQL_SERVER',
        hardCoded: false,
        value: process.env.SQL_SERVER || 'NOT SET',
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'vm_environment_variables',
        envVar: 'STORAGE_ACCOUNT_URL',
        value: STORAGE_URL || 'NOT SET',
        hardCoded: false,
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] VM Zonal App listening on port ${PORT}`);
  console.log(`VM:       ${VM_NAME}`);
  console.log(`Zone:     ${VM_ZONE}`);
  console.log(`SQL:      ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage:  ${STORAGE_URL || 'NOT SET'}`);
});
