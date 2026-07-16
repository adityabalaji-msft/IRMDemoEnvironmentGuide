// =============================================================================
// Scenario 3: Checkout Service (Shared Infrastructure)
// =============================================================================
// ⚠️ This service shares the SAME Front Door and SAME Storage Account
//    as the Loyalty Service (scenario3-loyalty).
//
// 🎯 BLAST RADIUS SIGNAL:
//    Updating or replacing the shared Front Door → BOTH checkout and loyalty
//    experience downtime simultaneously.
//    Migrating the shared Storage Account → BOTH services lose blob access.
//
// Individual config is fine (env vars used), but the SHARED resources
// create implicit dependencies between otherwise independent services.
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
const SCENARIO = process.env.SCENARIO || 'scenario3-checkout';

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: { encrypt: true, trustServerCertificate: false },
};

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'checkout',
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    sharedResources: {
      // ⚠️ Both checkout and loyalty point to the SAME storage URL
      storageUrl: process.env.STORAGE_ACCOUNT_URL,
      note: 'This storage is SHARED with loyalty service',
    },
  });
});

app.post('/checkout', async (req, res) => {
  const { orderId = `order-${Date.now()}`, items = [] } = req.body || {};
  const results = {};

  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input('orderId', sql.VarChar, orderId)
      .input('status', sql.VarChar, 'pending')
      .input('itemCount', sql.Int, items.length)
      .query(`
        IF OBJECT_ID('dbo.CheckoutOrders', 'U') IS NULL
          CREATE TABLE dbo.CheckoutOrders (
            OrderId VARCHAR(100) PRIMARY KEY,
            Status VARCHAR(50),
            ItemCount INT,
            CreatedAt DATETIME DEFAULT GETDATE()
          );
        INSERT INTO dbo.CheckoutOrders (OrderId, Status, ItemCount)
        VALUES (@orderId, @status, @itemCount);
      `);
    results.sql = { status: 'ok', orderId };
  } catch (err) {
    results.sql = { status: 'error', message: err.message };
  }

  try {
    const storageClient = new BlobServiceClient(process.env.STORAGE_ACCOUNT_URL);
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobContent = JSON.stringify({ service: 'checkout', orderId, items });
    const blockBlob = containerClient.getBlockBlobClient(`checkout/${orderId}.json`);
    await blockBlob.upload(blobContent, blobContent.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    results.storage = { status: 'ok', blob: `checkout/${orderId}.json` };
  } catch (err) {
    results.storage = { status: 'error', message: err.message };
  }

  res.json({ scenario: SCENARIO, service: 'checkout', orderId, results, timestamp: new Date().toISOString() });
});

app.post('/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 10 } = req.body || {};
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request().query(`
      IF OBJECT_ID('dbo.CheckoutLoyalty', 'U') IS NULL
        CREATE TABLE dbo.CheckoutLoyalty (
          CustomerId VARCHAR(100) PRIMARY KEY,
          Points INT DEFAULT 0,
          UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .query(`
        MERGE dbo.CheckoutLoyalty AS target
        USING (SELECT @customerId AS CustomerId, @points AS Points) AS source
        ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN UPDATE SET Points = target.Points + source.Points, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN INSERT (CustomerId, Points) VALUES (source.CustomerId, source.Points);
      `);
    res.json({ scenario: SCENARIO, service: 'checkout', customerId, pointsAdded: points, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ scenario: SCENARIO, service: 'checkout', error: err.message });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'checkout',
    riskLevel: 'MEDIUM-HIGH',
    dependencies: [
      {
        type: 'AzureSQLDatabase',
        configSource: 'environment_variable',
        hardCoded: false,
        shared: false,
        value: process.env.SQL_SERVER,
      },
      {
        type: 'AzureBlobStorage',
        configSource: 'environment_variable',
        hardCoded: false,
        // ⚠️ SHARED with loyalty service
        shared: true,
        sharedWith: ['loyalty-service'],
        value: process.env.STORAGE_ACCOUNT_URL,
        note: 'SHARED storage — migrating this impacts loyalty service too',
      },
      {
        type: 'AzureFrontDoor',
        configSource: 'infrastructure',
        hardCoded: false,
        // ⚠️ SHARED with loyalty service
        shared: true,
        sharedWith: ['loyalty-service'],
        note: 'SHARED Front Door — any change impacts both checkout and loyalty',
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Checkout service listening on port ${PORT}`);
  console.log(`SQL Server:   ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage URL:  ${process.env.STORAGE_ACCOUNT_URL || 'NOT SET'} (SHARED!)`);
});
