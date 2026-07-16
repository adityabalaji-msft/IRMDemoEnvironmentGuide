// =============================================================================
// SCENARIO 1: Safe Checkout Service (LOW RISK)
// =============================================================================
// ✅ Uses DNS alias for SQL (not hard-coded FQDN)
// ✅ Uses environment variables — no inline secrets
// ✅ Application Insights enabled with dependency tracking
// ✅ Storage referenced via env var
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix for all resources')
param baseName string = 'zr-safe'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

@description('Use zone-redundant App Service plan')
param zoneRedundant bool = false

var tags = {
  scenario: 'scenario1-safe'
  environment: environment
  riskLevel: 'low'
}

// --- Application Insights ---
module appInsights '../modules/appinsights.bicep' = {
  name: 'appInsights-deploy'
  params: {
    name: '${baseName}-ai'
    location: location
    tags: tags
  }
}

// --- Storage Account (Standard_LRS — non-zonal for demo contrast) ---
module storage '../modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    name: '${replace('${baseName}stor', '-', '')}${uniqueString(resourceGroup().id)}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
  }
}

// --- SQL Database ---
module sql '../modules/sqldb.bicep' = {
  name: 'sql-deploy'
  params: {
    name: baseName
    location: location
    tags: tags
    uniqueSuffix: uniqueString(resourceGroup().id)
    entraAdminLogin: entraAdminLogin
    entraAdminObjectId: entraAdminObjectId
  }
}

// --- Azure SQL DNS Alias (safe abstraction) ---
// This alias remains stable even if the underlying SQL server is replaced.
resource sqlServer 'Microsoft.Sql/servers@2022-05-01-preview' existing = {
  name: '${baseName}-${uniqueString(resourceGroup().id)}-sqlsvr'
}

resource sqlDnsAlias 'Microsoft.Sql/servers/dnsAliases@2021-11-01' = {
  parent: sqlServer
  name: '${baseName}-${uniqueString(resourceGroup().id)}-sqlalias'
  dependsOn: [
    sql
  ]
}

var sqlAliasFqdn = '${baseName}-${uniqueString(resourceGroup().id)}-sqlalias.database.windows.net'

// --- App Service ---
// KEY SIGNAL: SQL_SERVER is set to the FQDN as an env var — abstracted, not hard-coded in code
module appService '../modules/appservice.bicep' = {
  name: 'appservice-deploy'
  params: {
    name: '${baseName}-checkout'
    location: location
    tags: tags
    planSku: zoneRedundant ? 'P1v3' : 'F1'
    zoneRedundant: zoneRedundant
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    appSettings: [
      {
        // ✅ SAFE: Uses Azure SQL DNS alias, set via deployment — not hard-coded in app code
        name: 'SQL_SERVER'
        value: sqlAliasFqdn
      }
      {
        name: 'SQL_DATABASE'
        value: sql.outputs.sqlDatabaseName
      }
      {
        // ✅ SAFE: Storage URL from output — env var, not hard-coded
        name: 'STORAGE_ACCOUNT_URL'
        value: storage.outputs.primaryEndpointBlob
      }
      {
        name: 'SCENARIO'
        value: 'scenario1-safe'
      }
    ]
  }
}

// =============================================================================
// OUTPUTS
// =============================================================================
output appServiceUrl string = appService.outputs.appServiceUrl
output appServiceName string = appService.outputs.appServiceName
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlServerAliasFqdn string = sqlAliasFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output storageAccountName string = storage.outputs.storageAccountName
output storageEndpoint string = storage.outputs.primaryEndpointBlob
output appInsightsConnectionString string = appInsights.outputs.connectionString
output appInsightsName string = appInsights.outputs.appInsightsName
