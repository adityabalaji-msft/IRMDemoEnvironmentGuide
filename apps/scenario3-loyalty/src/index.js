// =============================================================================
// Scenario 3: Loyalty Service (Shared Infrastructure)
// =============================================================================
// ⚠️ Shares the SAME Front Door and SAME Storage Account as checkout service
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
const SCENARIO = process.env.SCENARIO || 'scenario3-loyalty';

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
    service: 'loyalty',
    scenario: SCENARIO,
    timestamp: new Date().toISOString(),
    sharedResources: {
      storageUrl: process.env.STORAGE_ACCOUNT_URL,
      note: 'This storage is SHARED with checkout service',
    },
  });
});

app.post('/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 0 } = req.body || {};
  const results = {};

  // Add loyalty points to SQL
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .query(`
        IF OBJECT_ID('dbo.LoyaltyPoints', 'U') IS NULL
          CREATE TABLE dbo.LoyaltyPoints (
            CustomerId VARCHAR(100) PRIMARY KEY,
            Points INT DEFAULT 0,
            UpdatedAt DATETIME DEFAULT GETDATE()
          );
        MERGE dbo.LoyaltyPoints AS target
        USING (SELECT @customerId AS CustomerId, @points AS Points) AS source
        ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN
          UPDATE SET Points = target.Points + source.Points, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (CustomerId, Points) VALUES (source.CustomerId, source.Points);
      `);
    results.sql = { status: 'ok', customerId, pointsAdded: points };
  } catch (err) {
    results.sql = { status: 'error', message: err.message };
  }

  // Write loyalty event to shared blob storage
  try {
    const storageClient = new BlobServiceClient(process.env.STORAGE_ACCOUNT_URL);
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobContent = JSON.stringify({ service: 'loyalty', customerId, points, timestamp: new Date().toISOString() });
    const blockBlob = containerClient.getBlockBlobClient(`loyalty/${customerId}-${Date.now()}.json`);
    await blockBlob.upload(blobContent, blobContent.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    results.storage = { status: 'ok' };
  } catch (err) {
    results.storage = { status: 'error', message: err.message };
  }

  res.json({ scenario: SCENARIO, service: 'loyalty', customerId, pointsAdded: points, results, timestamp: new Date().toISOString() });
});

// GET loyalty balance
app.get('/loyalty/:customerId', async (req, res) => {
  const { customerId } = req.params;
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .query('SELECT Points FROM dbo.LoyaltyPoints WHERE CustomerId = @customerId');
    const points = result.recordset[0]?.Points ?? 0;
    res.json({ customerId, points, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'loyalty',
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
        shared: true,
        sharedWith: ['checkout-service'],
        value: process.env.STORAGE_ACCOUNT_URL,
        note: 'SHARED storage — migrating this impacts checkout service too',
      },
      {
        type: 'AzureFrontDoor',
        configSource: 'infrastructure',
        hardCoded: false,
        shared: true,
        sharedWith: ['checkout-service'],
        note: 'SHARED Front Door — blast radius includes checkout service',
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Loyalty service listening on port ${PORT}`);
  console.log(`SQL Server:   ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage URL:  ${process.env.STORAGE_ACCOUNT_URL || 'NOT SET'} (SHARED!)`);
});
