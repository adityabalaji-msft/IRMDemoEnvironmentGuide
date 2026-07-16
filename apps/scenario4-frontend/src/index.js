// =============================================================================
// Scenario 4: AKS Frontend Service
// =============================================================================
// - Calls the backend API via K8s internal service DNS (backend-service.default.svc.cluster.local)
// - Reads assets from Azure Storage (URL from ConfigMap)
//
// 🎯 SIGNALS:
//    BACKEND_URL = K8s internal service name — requires K8s service discovery insight
//    STORAGE_ACCOUNT_URL = External Azure resource — requires ConfigMap inspection
//    Both are invisible from AKS cluster-level control plane analysis alone
// =============================================================================

require('dotenv').config();
const appInsights = require('applicationinsights');

appInsights
  .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectDependencies(true)  // Tracks HTTP calls to backend + Storage
  .setAutoCollectExceptions(true)
  .setSendLiveMetrics(true)
  .start();

const express = require('express');
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCENARIO = 'scenario4-aks-frontend';

// K8s internal service name — set via ConfigMap
// e.g. http://backend-service.default.svc.cluster.local:8080
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-service:8080';
const STORAGE_URL = process.env.STORAGE_ACCOUNT_URL;
const STORAGE_ACCOUNT_NAME = process.env.STORAGE_ACCOUNT_NAME;
const STORAGE_ACCOUNT_KEY = process.env.STORAGE_ACCOUNT_KEY;

// Build authenticated storage client using account key
let storageClient = null;
if (STORAGE_URL && STORAGE_ACCOUNT_NAME && STORAGE_ACCOUNT_KEY) {
  const sharedKeyCred = new StorageSharedKeyCredential(STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY);
  storageClient = new BlobServiceClient(STORAGE_URL, sharedKeyCred);
} else if (STORAGE_URL) {
  storageClient = new BlobServiceClient(STORAGE_URL);
}

// --- HTML Landing Page ---
app.get('/', async (req, res) => {
  // Check backend health
  let backendStatus = { ok: false, detail: '' };
  try {
    const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    backendStatus = { ok: r.ok, detail: JSON.stringify(d, null, 2) };
  } catch (err) {
    backendStatus = { ok: false, detail: err.message };
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

  const allHealthy = backendStatus.ok && storageStatus.ok;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo — AKS Based App Dashboard</title>
  <meta http-equiv="refresh" content="10">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; padding: 2rem; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.8rem; color: #58a6ff; }
    .header p { color: #8b949e; margin-top: 0.5rem; }
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
    .pod-info { text-align: center; color: #484f58; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔷 Demo — AKS Based App</h1>
    <p>Dependency Health Dashboard</p>
  </div>

  <div class="overall">
    <h2>${allHealthy ? '✅ ALL SYSTEMS OPERATIONAL' : '🔴 DEGRADED — DEPENDENCY FAILURE DETECTED'}</h2>
    <p>${allHealthy ? 'All dependencies are reachable and healthy' : 'One or more dependencies are unreachable — see details below'}</p>
  </div>

  <div class="grid">
    <div class="card ${backendStatus.ok ? 'ok' : 'fail'}">
      <h3><span class="dot ${backendStatus.ok ? 'green' : 'red'}"></span> Backend API Service</h3>
      <div class="meta">
        <strong>Type:</strong> Kubernetes Service (internal) &nbsp;|&nbsp;
        <strong>Source:</strong> ConfigMap <code>frontend-config</code>
      </div>
      <div class="meta"><strong>URL:</strong> ${BACKEND_URL}</div>
      <div class="meta"><strong>Status:</strong> ${backendStatus.ok ? '🟢 Connected' : '🔴 Unreachable'}</div>
      <div class="detail">${backendStatus.detail}</div>
    </div>

    <div class="card ${storageStatus.ok ? 'ok' : 'fail'}">
      <h3><span class="dot ${storageStatus.ok ? 'green' : 'red'}"></span> Azure Blob Storage</h3>
      <div class="meta">
        <strong>Type:</strong> Azure Storage Account (external) &nbsp;|&nbsp;
        <strong>Source:</strong> ConfigMap <code>frontend-config</code>
      </div>
      <div class="meta"><strong>URL:</strong> ${STORAGE_URL || 'NOT SET'}</div>
      <div class="meta"><strong>Status:</strong> ${storageStatus.ok ? '🟢 Connected' : '🔴 Unreachable'}</div>
      <div class="detail">${storageStatus.detail}</div>
    </div>
  </div>

  <div class="endpoints">
    <h3>📡 Available API Endpoints</h3>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/health">/health</a></span><span>Service health check</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/products">/products</a></span><span>Fetch products from backend</span></div>
    <div class="endpoint"><span><span class="badge post">POST</span> /checkout</span><span>Submit order via backend</span></div>
    <div class="endpoint"><span><span class="badge post">POST</span> /loyalty</span><span>Check loyalty points via backend</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/assets">/assets</a></span><span>List blobs in Azure Storage</span></div>
    <div class="endpoint"><span><span class="badge get">GET</span> <a href="/dependencies">/dependencies</a></span><span>Dependency map (JSON)</span></div>
  </div>

  <div class="pod-info">
    Pod: ${process.env.POD_NAME || 'unknown'} &middot;
    Node: ${process.env.NODE_NAME || 'unknown'} &middot;
    Auto-refreshes every 10s &middot;
    ${new Date().toISOString()}
  </div>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'frontend',
    scenario: SCENARIO,
    pod: process.env.POD_NAME || 'unknown',
    timestamp: new Date().toISOString(),
    config: {
      backendUrl: BACKEND_URL,
      storageUrl: STORAGE_URL || 'NOT SET',
      configSource: 'kubernetes-configmap',
    },
  });
});

app.get('/products', async (req, res) => {
  try {
    // HTTP call to backend — App Insights tracks this as outbound HTTP dependency
    const response = await fetch(`${BACKEND_URL}/api/products`);
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    const data = await response.json();
    res.json({
      service: 'frontend',
      products: data.products,
      fetchedFrom: BACKEND_URL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({
      error: 'Backend unavailable',
      backendUrl: BACKEND_URL,
      detail: err.message,
      hint: 'Check ConfigMap frontend-config for BACKEND_URL',
    });
  }
});

app.post('/checkout', async (req, res) => {
  const body = req.body || {};
  try {
    const response = await fetch(`${BACKEND_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json({ service: 'frontend', ...data });
  } catch (err) {
    res.status(502).json({ error: 'Backend unavailable', detail: err.message });
  }
});

app.post('/loyalty', async (req, res) => {
  const body = req.body || {};
  try {
    const response = await fetch(`${BACKEND_URL}/api/loyalty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json({ service: 'frontend', ...data });
  } catch (err) {
    res.status(502).json({ error: 'Backend unavailable', detail: err.message });
  }
});

app.get('/assets', async (req, res) => {
  if (!storageClient) {
    return res.status(503).json({ error: 'STORAGE_ACCOUNT_URL/KEY not configured in ConfigMap' });
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
    service: 'frontend',
    riskLevel: 'MEDIUM',
    note: 'Internal K8s service (backend-service) + external Azure Storage — both invisible from AKS control plane',
    dependencies: [
      {
        type: 'KubernetesService',
        configSource: 'kubernetes_configmap',
        configMapName: 'frontend-config',
        envVar: 'BACKEND_URL',
        value: BACKEND_URL,
        hardCoded: false,
        internal: true,
        note: 'K8s internal service DNS — resolves only within cluster',
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'kubernetes_configmap',
        configMapName: 'frontend-config',
        envVar: 'STORAGE_ACCOUNT_URL',
        value: STORAGE_URL || 'NOT SET',
        hardCoded: false,
        internal: false,
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Frontend service listening on port ${PORT}`);
  console.log(`Backend URL:  ${BACKEND_URL}`);
  console.log(`Storage URL:  ${STORAGE_URL || 'NOT SET'}`);
});
