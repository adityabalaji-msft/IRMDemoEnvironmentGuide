// =============================================================================
// Scenario 6: Worker VM — Data Sync Agent
// =============================================================================
// A lightweight background worker running on a second zone-pinned VM.
// Simulates periodic data synchronization tasks.
// Used to demonstrate sequential VM recovery in a zone failure scenario.
// =============================================================================

require('dotenv').config();
const express = require('express');
const os = require('os');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;
const VM_ZONE = process.env.VM_ZONE || 'unknown';
const VM_NAME = process.env.VM_NAME || os.hostname();
const WORKER_ROLE = 'data-sync-agent';

// --- Simulated work state ---
let syncState = {
  lastSyncTime: null,
  syncCount: 0,
  status: 'idle',
  recordsProcessed: 0
};

// Simulate periodic background sync work
function performSync() {
  syncState.status = 'syncing';
  const records = Math.floor(Math.random() * 500) + 100;

  setTimeout(() => {
    syncState.lastSyncTime = new Date().toISOString();
    syncState.syncCount++;
    syncState.recordsProcessed += records;
    syncState.status = 'idle';
  }, 2000);
}

// Run sync every 30 seconds
setInterval(performSync, 30000);
// Run initial sync after 5 seconds
setTimeout(performSync, 5000);

// --- Health endpoint ---
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'vm-worker',
    role: WORKER_ROLE,
    vm: VM_NAME,
    zone: VM_ZONE,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    syncState: {
      status: syncState.status,
      lastSyncTime: syncState.lastSyncTime,
      syncCount: syncState.syncCount,
      recordsProcessed: syncState.recordsProcessed
    }
  });
});

// --- Worker status page ---
app.get('/', (req, res) => {
  const uptimeMin = Math.floor(process.uptime() / 60);
  res.send(`<!DOCTYPE html>
<html><head>
  <title>Worker VM — Data Sync Agent</title>
  <meta http-equiv="refresh" content="10">
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; padding: 2rem; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { color: #d2a8ff; font-size: 1.5rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; max-width: 500px; margin: 0 auto; }
    .stat { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #21262d; }
    .stat:last-child { border-bottom: none; }
    .label { color: #8b949e; }
    .value { color: #58a6ff; font-family: monospace; }
    .zone-badge { display: inline-block; background: #da363333; border: 1px solid #da3633; color: #f85149;
      padding: 0.3rem 1rem; border-radius: 12px; font-size: 0.9rem; margin-top: 0.5rem; }
  </style>
</head><body>
  <div class="header">
    <h1>⚙️ Worker VM — Data Sync Agent</h1>
    <div class="zone-badge">⚠️ ZONE ${VM_ZONE}</div>
  </div>
  <div class="card">
    <div class="stat"><span class="label">VM Name</span><span class="value">${VM_NAME}</span></div>
    <div class="stat"><span class="label">Role</span><span class="value">${WORKER_ROLE}</span></div>
    <div class="stat"><span class="label">Status</span><span class="value">${syncState.status}</span></div>
    <div class="stat"><span class="label">Uptime</span><span class="value">${uptimeMin} min</span></div>
    <div class="stat"><span class="label">Sync Count</span><span class="value">${syncState.syncCount}</span></div>
    <div class="stat"><span class="label">Records Processed</span><span class="value">${syncState.recordsProcessed.toLocaleString()}</span></div>
    <div class="stat"><span class="label">Last Sync</span><span class="value">${syncState.lastSyncTime || 'pending...'}</span></div>
  </div>
</body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Worker VM (${WORKER_ROLE}) listening on port ${PORT} — Zone ${VM_ZONE}`);
});
