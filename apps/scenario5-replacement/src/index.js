// =============================================================================
// Scenario 5: App Service Plan Replacement Demo
// =============================================================================
// This app is the SAME code deployed to both:
//   - Original App Service (B1 plan, non-zonal): zr-replace-checkout.azurewebsites.net
//   - Replacement App Service (P1v3 ZR): zr-replace-checkout-zr.azurewebsites.net
//
// 🎯 MIGRATION RISK SIGNALS:
//    1. BACKEND_URL env var — any system referencing the original URL must be
//       updated when the new App Service has a different hostname.
//    2. During the migration window, both old and new apps run simultaneously.
//       Traffic must be cut over (via Front Door / DNS) once the new one is verified.
//    3. The /migration-status endpoint reports whether this is original or replacement.
//
// 🚨 WHAT BREAKS:
//    - Any downstream service calling the old azurewebsites.net URL will fail
//      after the old app is deleted.
//    - API Management policies, front-end configs, or other apps pointing to the
//      original URL must all be updated.
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
const SCENARIO = process.env.SCENARIO || 'scenario5-replacement';

// Determine if this is the original or replacement deployment
// PLAN_TYPE is set by Bicep via app settings
const PLAN_TYPE = process.env.PLAN_TYPE || 'original';
const IS_ZONE_REDUNDANT = process.env.IS_ZONE_REDUNDANT === 'true';

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
    scenario: SCENARIO,
    planType: PLAN_TYPE,
    isZoneRedundant: IS_ZONE_REDUNDANT,
    appUrl: process.env.BACKEND_URL || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Migration status endpoint — reports plan details for validation
app.get('/migration-status', (req, res) => {
  const originalUrl = 'https://zr-replace-checkout.azurewebsites.net';
  const replacementUrl = 'https://zr-replace-checkout-zr.azurewebsites.net';

  res.json({
    scenario: SCENARIO,
    planType: PLAN_TYPE,
    isZoneRedundant: IS_ZONE_REDUNDANT,
    currentUrl: process.env.BACKEND_URL,
    migration: {
      originalUrl,
      replacementUrl,
      // Status depends on which deployment we're running in
      status: PLAN_TYPE === 'replacement' ? 'replacement-active' : 'original-active',
      // Systems that need to be updated when migration completes:
      affectedSystems: [
        'Any downstream service calling ' + originalUrl,
        'API Management backend pool',
        'Front Door origin settings',
        'Load test scripts',
        'Monitoring dashboards',
      ],
    },
    timestamp: new Date().toISOString(),
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
      .input('planType', sql.VarChar, PLAN_TYPE)
      .query(`
        IF OBJECT_ID('dbo.Scenario5Orders', 'U') IS NULL
          CREATE TABLE dbo.Scenario5Orders (
            OrderId VARCHAR(100) PRIMARY KEY,
            Status VARCHAR(50),
            ItemCount INT,
            PlanType VARCHAR(50),
            CreatedAt DATETIME DEFAULT GETDATE()
          );
        INSERT INTO dbo.Scenario5Orders (OrderId, Status, ItemCount, PlanType)
        VALUES (@orderId, @status, @itemCount, @planType);
      `);
    results.sql = { status: 'ok', orderId };
  } catch (err) {
    results.sql = { status: 'error', message: err.message };
  }

  try {
    const storageClient = new BlobServiceClient(process.env.STORAGE_ACCOUNT_URL);
    const containerClient = storageClient.getContainerClient('demo-data');
    const blobContent = JSON.stringify({ orderId, items, planType: PLAN_TYPE, timestamp: new Date().toISOString() });
    const blockBlob = containerClient.getBlockBlobClient(`scenario5/${orderId}.json`);
    await blockBlob.upload(blobContent, blobContent.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    results.storage = { status: 'ok' };
  } catch (err) {
    results.storage = { status: 'error', message: err.message };
  }

  res.json({ scenario: SCENARIO, planType: PLAN_TYPE, orderId, results, timestamp: new Date().toISOString() });
});

app.post('/loyalty', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, points = 10 } = req.body || {};
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request().query(`
      IF OBJECT_ID('dbo.Scenario5Loyalty', 'U') IS NULL
        CREATE TABLE dbo.Scenario5Loyalty (
          CustomerId VARCHAR(100) PRIMARY KEY,
          Points INT DEFAULT 0,
          PlanType VARCHAR(50),
          UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .input('planType', sql.VarChar, PLAN_TYPE)
      .query(`
        MERGE dbo.Scenario5Loyalty AS target
        USING (SELECT @customerId AS CustomerId, @points AS Points, @planType AS PlanType) AS source
        ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN UPDATE SET Points = target.Points + source.Points, PlanType = source.PlanType, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN INSERT (CustomerId, Points, PlanType) VALUES (source.CustomerId, source.Points, source.PlanType);
      `);

    res.json({ scenario: SCENARIO, planType: PLAN_TYPE, customerId, pointsAdded: points, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ scenario: SCENARIO, planType: PLAN_TYPE, error: err.message });
  }
});

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    planType: PLAN_TYPE,
    riskLevel: PLAN_TYPE === 'original' ? 'HIGH' : 'LOW',
    risks: PLAN_TYPE === 'original' ? [
      'App Service Plan (B1) does not support zone redundancy',
      'Plan MUST be replaced (not updated) to enable ZR — new resource, new URL',
      'All downstream systems referencing this URL must be updated',
      'Migration requires traffic cutover validation',
    ] : [
      'Zone-redundant P1v3 plan active',
      'Validate all downstream systems have been updated to new URL',
    ],
    dependencies: [
      { type: 'AzureSQLDatabase', envVar: 'SQL_SERVER', hardCoded: false },
      { type: 'AzureBlobStorage', envVar: 'STORAGE_ACCOUNT_URL', hardCoded: false },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Listening on port ${PORT} (Plan: ${PLAN_TYPE}, ZoneRedundant: ${IS_ZONE_REDUNDANT})`);
  console.log(`SQL Server:   ${process.env.SQL_SERVER || 'NOT SET'}`);
  console.log(`Storage URL:  ${process.env.STORAGE_ACCOUNT_URL || 'NOT SET'}`);
});
