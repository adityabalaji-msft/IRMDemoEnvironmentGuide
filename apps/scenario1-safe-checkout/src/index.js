// =============================================================================
// Scenario 1: SAFE Checkout Service
// =============================================================================
// ✅ Application Insights initialized FIRST — captures all outbound dependencies
// ✅ All configuration from environment variables — no hard-coded endpoints
// ✅ SQL and Storage are referenced via env vars set at deployment time
// ✅ /health endpoint for liveness probe + App Insights availability monitoring
// =============================================================================

// IMPORTANT: AppInsights must be required BEFORE other modules
require('dotenv').config();
const appInsights = require('applicationinsights');

// Initialize Application Insights with dependency auto-collection
// This automatically tracks: SQL queries, HTTP calls, blob operations
appInsights
  .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectDependencies(true)   // ← captures SQL, HTTP, Redis calls
  .setAutoCollectExceptions(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectHeartbeat(true)
  .setSendLiveMetrics(true)
  .start();

const express = require('express');
const sql = require('mssql');
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SCENARIO = process.env.SCENARIO || 'scenario1-safe';

// =============================================================================
// SQL Configuration — ALL from environment variables (SAFE pattern)
// =============================================================================
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  // ✅ SQL_SERVER comes from env var set by Bicep deployment — not hard-coded
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    requestTimeout: 5000,
    connectionTimeout: 5000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// =============================================================================
// Storage Client — URL from environment variable (SAFE pattern)
// =============================================================================
function getStorageClient() {
  // ✅ STORAGE_ACCOUNT_URL from env var — not hard-coded
  const url = process.env.STORAGE_ACCOUNT_URL;
  if (!url) return null;
  // In production, use Managed Identity (DefaultAzureCredential)
  // For demo, we use anonymous access to the public endpoint (read-only demo)
  return new BlobServiceClient(url);
}

// =============================================================================
// ROUTES
// =============================================================================

// Health check — also acts as App Insights availability ping target
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    config: {
      sqlServer: process.env.SQL_SERVER ? 'configured' : 'missing',
      storageUrl: process.env.STORAGE_ACCOUNT_URL ? 'configured' : 'missing',
      appInsights: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? 'enabled' : 'disabled',
    },
  });
});

// Checkout endpoint — simulates SQL + Storage dependency
app.post('/checkout', async (req, res) => {
  const { orderId = `order-${Date.now()}`, items = [] } = req.body || {};
  const results = {};

  // --- SQL Dependency (tracked by App Insights) ---
  try {
    const pool = await sql.connect(sqlConfig);
    // Simulate writing an order record
    await pool.request()
      .input('orderId', sql.VarChar, orderId)
      .input('status', sql.VarChar, 'pending')
      .input('itemCount', sql.Int, items.length)
      .query(`
        IF OBJECT_ID('dbo.Orders', 'U') IS NULL
          CREATE TABLE dbo.Orders (
            OrderId VARCHAR(100) PRIMARY KEY,
            Status VARCHAR(50),
            ItemCount INT,
            CreatedAt DATETIME DEFAULT GETDATE()
          );
        INSERT INTO dbo.Orders (OrderId, Status, ItemCount)
        VALUES (@orderId, @status, @itemCount);
      `);
    results.sql = { status: 'ok', orderId };
  } catch (err) {
    results.sql = { status: 'error', message: err.message };
  }

  // --- Storage Dependency (tracked by App Insights) ---
  try {
    const storageClient = getStorageClient();
    if (storageClient) {
      const containerClient = storageClient.getContainerClient('demo-data');
      // Simulate writing order metadata as a blob
      const blobContent = JSON.stringify({ orderId, items, timestamp: new Date().toISOString() });
      const blockBlob = containerClient.getBlockBlobClient(`orders/${orderId}.json`);
      await blockBlob.upload(blobContent, blobContent.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
      results.storage = { status: 'ok', blob: `orders/${orderId}.json` };
    } else {
      results.storage = { status: 'skipped', reason: 'STORAGE_ACCOUNT_URL not configured' };
    }
  } catch (err) {
    results.storage = { status: 'error', message: err.message };
  }

  res.json({
    scenario: SCENARIO,
    orderId,
    itemCount: items.length,
    results,
    timestamp: new Date().toISOString(),
  });
});

// Simple loyalty simulation endpoint for cross-scenario API parity
app.post('/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 10 } = req.body || {};
  let sqlResult = { status: 'skipped' };
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request().query(`
      IF OBJECT_ID('dbo.LoyaltyPoints', 'U') IS NULL
        CREATE TABLE dbo.LoyaltyPoints (
          CustomerId VARCHAR(100) PRIMARY KEY,
          Points INT DEFAULT 0,
          UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .query(`
        MERGE dbo.LoyaltyPoints AS target
        USING (SELECT @customerId AS CustomerId, @points AS Points) AS source
        ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN UPDATE SET Points = target.Points + source.Points, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN INSERT (CustomerId, Points) VALUES (source.CustomerId, source.Points);
      `);
    sqlResult = { status: 'ok' };
  } catch (err) {
    sqlResult = { status: 'error', message: err.message };
  }

  res.json({ scenario: SCENARIO, customerId, pointsAdded: points, sql: sqlResult, timestamp: new Date().toISOString() });
});

// Dependency info — useful for the ZR tooling to inspect what this app connects to
app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    riskLevel: 'LOW',
    dependencies: [
      {
        type: 'AzureSQLDatabase',
        configSource: 'environment_variable',
        envVar: 'SQL_SERVER',
        value: process.env.SQL_SERVER || 'not-configured',
        hardCoded: false,
        note: 'Set via Bicep output → App Service app setting',
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'environment_variable',
        envVar: 'STORAGE_ACCOUNT_URL',
        value: process.env.STORAGE_ACCOUNT_URL || 'not-configured',
        hardCoded: false,
        note: 'Set via Bicep output → App Service app setting',
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Listening on port ${PORT}`);
  console.log(`SQL Server:   ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage URL:  ${process.env.STORAGE_ACCOUNT_URL || 'NOT SET'}`);
  console.log(`App Insights: ${process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? 'ENABLED' : 'DISABLED'}`);
});
