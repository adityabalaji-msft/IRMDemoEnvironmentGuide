// =============================================================================
// Scenario 2: RISKY Checkout Service — Hard-coded Dependencies
// =============================================================================
// ❌ SQL server FQDN is hard-coded directly in this file
// ❌ Storage account URL is hard-coded directly in this file
// ❌ No DNS abstraction layer
// ❌ No environment variable override — values are baked into the binary
//
// 🎯 DETECTION SIGNAL:
//    A static analysis tool scanning this file will find literal strings
//    matching Azure resource endpoint patterns:
//      - *.database.windows.net
//      - *.blob.core.windows.net
//    These are clear indicators of hard-coded dependency risk.
//
// 🚨 MIGRATION RISK:
//    If the SQL server is replaced (e.g. during ZR migration), the new FQDN
//    will differ and this app will BREAK without a code change + redeployment.
// =============================================================================

require('dotenv').config();
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
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SCENARIO = 'scenario2-hardcoded';

// =============================================================================
// ❌ ANTI-PATTERN: Hard-coded SQL Configuration
// These values were copied from the Azure portal and pasted directly here.
// If the SQL server is migrated or replaced, this code MUST be updated.
// The deploy script (deploy-scenario.sh) injects the real FQDNs here.
// =============================================================================
const sqlConfig = {
  user: 'sqladmin',
  // ❌ HARD-CODED: Replace marker injected by deploy script
  password: process.env.SQL_PASSWORD || 'CHANGEME',  // password still env var (common partial pattern)
  // ❌ HARD-CODED SQL SERVER FQDN — static analysis target
  server: 'HARDCODED_SQL_SERVER_FQDN',    // e.g. zr-risky-sqlsvr.database.windows.net
  database: 'HARDCODED_SQL_DATABASE',     // e.g. zr-risky-db
  options: {
    encrypt: true,
    trustServerCertificate: false,
    requestTimeout: 5000,
    connectionTimeout: 5000,
  },
};

// =============================================================================
// ❌ ANTI-PATTERN: Hard-coded Storage Endpoint
// If the storage account is migrated, this URL will break.
// =============================================================================
// ❌ HARD-CODED STORAGE ENDPOINT — static analysis target
const STORAGE_ACCOUNT_URL = 'HARDCODED_STORAGE_ENDPOINT'; // e.g. https://zrristorstor.blob.core.windows.net/

// =============================================================================
// ROUTES
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    // ⚠️ These expose the hard-coded values, making detection easy
    config: {
      sqlServer: sqlConfig.server,
      storageUrl: STORAGE_ACCOUNT_URL,
      hardCoded: true,
      riskLevel: 'HIGH',
    },
  });
});

app.post('/checkout', async (req, res) => {
  const { orderId = `order-${Date.now()}`, items = [] } = req.body || {};
  const results = {};

  // SQL dependency — App Insights tracks the call to the hard-coded server
  try {
    const pool = await sql.connect(sqlConfig);
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

  // Storage dependency — App Insights tracks the call to the hard-coded endpoint
  try {
    const storageClient = new BlobServiceClient(STORAGE_ACCOUNT_URL);
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobContent = JSON.stringify({ orderId, items, timestamp: new Date().toISOString() });
    const blockBlob = containerClient.getBlockBlobClient(`orders/${orderId}.json`);
    await blockBlob.upload(blobContent, blobContent.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    results.storage = { status: 'ok', blob: `orders/${orderId}.json` };
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

// Loyalty endpoint using the same hard-coded SQL server to simulate additional risky dependency usage
app.post('/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 10 } = req.body || {};
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

    res.json({ scenario: SCENARIO, customerId, pointsAdded: points, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ scenario: SCENARIO, error: err.message });
  }
});

// Dependency info — exposes the hard-coded config for tooling inspection
app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    riskLevel: 'HIGH',
    dependencies: [
      {
        type: 'AzureSQLDatabase',
        configSource: 'hard_coded_in_source',
        envVar: null,
        value: sqlConfig.server,
        hardCoded: true,
        note: 'Direct FQDN in source code — breaks if server is replaced',
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'hard_coded_in_source',
        envVar: null,
        value: STORAGE_ACCOUNT_URL,
        hardCoded: true,
        note: 'Direct URL in source code — breaks if storage account is renamed/migrated',
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Listening on port ${PORT}`);
  console.log(`SQL Server (HARD-CODED):  ${sqlConfig.server}`);
  console.log(`Storage URL (HARD-CODED): ${STORAGE_ACCOUNT_URL}`);
  console.log(`App Insights: ${process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ? 'ENABLED' : 'DISABLED'}`);
});
