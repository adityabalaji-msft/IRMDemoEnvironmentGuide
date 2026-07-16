// =============================================================================
// Scenario 4: AKS Backend API Service
// =============================================================================
// Config consumed from:
//   1. Environment variables (from K8s ConfigMap — see k8s/configmap.yaml)
//   2. K8s Secrets (SQL password)
//
// 🎯 DETECTION SIGNAL:
//    Control-plane-only analysis (AKS resource) cannot see WHERE the app connects.
//    Runtime dependency tracking via App Insights + ConfigMap inspection
//    are required to discover SQL_SERVER and STORAGE endpoints.
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

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCENARIO = 'scenario4-aks-backend';

// Config arrives via K8s ConfigMap environment variables
// Supports both SQL auth (password) and Entra-only auth (DefaultAzureCredential)
const USE_ENTRA_AUTH = (process.env.SQL_AUTH_TYPE || '').toLowerCase() === 'entra';

let sqlConfig;
if (USE_ENTRA_AUTH) {
  // Entra-only auth using DefaultAzureCredential (az login for local dev)
  const { DefaultAzureCredential } = require('@azure/identity');
  const credential = new DefaultAzureCredential();
  sqlConfig = {
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    authentication: {
      type: 'azure-active-directory-access-token',
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      requestTimeout: 5000,
      connectionTimeout: 5000,
    },
    beforeConnect: async (conn) => {
      const tokenResponse = await credential.getToken('https://database.windows.net/.default');
      conn.authentication.options.token = tokenResponse.token;
    },
  };
} else {
  sqlConfig = {
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

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'backend',
    scenario: SCENARIO,
    pod: process.env.POD_NAME || 'unknown',
    node: process.env.NODE_NAME || 'unknown',
    namespace: process.env.POD_NAMESPACE || 'unknown',
    timestamp: new Date().toISOString(),
    config: {
      sqlServer: process.env.SQL_SERVER || 'NOT SET — check ConfigMap',
      sqlAuthType: USE_ENTRA_AUTH ? 'entra (DefaultAzureCredential)' : 'sql-password',
      configSource: 'kubernetes-configmap',
    },
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    // Ensure demo table exists
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
    res.json({ products: result.recordset, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, hint: 'Check ConfigMap sql-config for SQL_SERVER value' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customerId = `cust-${Date.now()}`, productId = 1, quantity = 1 } = req.body || {};
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request().query(`
      IF OBJECT_ID('dbo.AksOrders', 'U') IS NULL
        CREATE TABLE dbo.AksOrders (
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
        INSERT INTO dbo.AksOrders (CustomerId, ProductId, Quantity)
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
    const pool = await sql.connect(sqlConfig);
    await pool.request().query(`
      IF OBJECT_ID('dbo.AksLoyalty', 'U') IS NULL
        CREATE TABLE dbo.AksLoyalty (
          CustomerId VARCHAR(100) PRIMARY KEY,
          Points INT DEFAULT 0,
          UpdatedAt DATETIME DEFAULT GETDATE()
        );
    `);
    await pool.request()
      .input('customerId', sql.VarChar, customerId)
      .input('points', sql.Int, points)
      .query(`
        MERGE dbo.AksLoyalty AS target
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

app.get('/dependencies', (req, res) => {
  res.json({
    scenario: SCENARIO,
    service: 'backend',
    riskLevel: 'MEDIUM',
    configMethod: 'kubernetes-configmap',
    note: 'Control-plane analysis alone cannot detect these — requires ConfigMap inspection or runtime telemetry',
    dependencies: [
      {
        type: 'AzureSQLDatabase',
        configSource: 'kubernetes_configmap',
        configMapName: 'backend-config',
        envVar: 'SQL_SERVER',
        hardCoded: false,
        value: process.env.SQL_SERVER || 'NOT SET',
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[${SCENARIO}] Backend API listening on port ${PORT}`);
  console.log(`SQL Server: ${process.env.SQL_SERVER || 'NOT SET — check ConfigMap'}`);
  console.log(`Pod: ${process.env.POD_NAME || 'unknown'}`);
});
