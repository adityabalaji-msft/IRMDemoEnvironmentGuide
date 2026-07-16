// =============================================================================
// SCENARIO 2: Hard-coded Dependency Checkout Service (HIGH RISK)
// =============================================================================
// ❌ SQL endpoint will be hard-coded in the APP CODE (see apps/scenario2-hardcoded)
// ❌ Storage endpoint will be hard-coded in the APP CODE
// ❌ No DNS abstraction — direct FQDN references
// 🎯 Purpose: Simulate detection of hard-coded resource references
//             that break on resource replacement
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix for all resources')
param baseName string = 'zr-risky'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

var tags = {
  scenario: 'scenario2-hardcoded'
  environment: environment
  riskLevel: 'high'
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

// --- Storage Account ---
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

// --- App Service ---
// ⚠️  NOTE: The risky behaviour is in the APP CODE (apps/scenario2-hardcoded/src/index.js)
//     The SQL and Storage endpoints are hard-coded directly in the source code.
//     This infrastructure deliberately does NOT pass SQL_SERVER/STORAGE_ACCOUNT_URL
//     as env vars — the app uses hard-coded values instead.
module appService '../modules/appservice.bicep' = {
  name: 'appservice-deploy'
  params: {
    name: '${baseName}-checkout'
    location: location
    tags: tags
    planSku: 'F1'  // ❌ Non-zonal SKU — also a risk signal
    zoneRedundant: false
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    appSettings: [
      {
        name: 'SCENARIO'
        value: 'scenario2-hardcoded'
      }
      // ❌ SQL_SERVER and STORAGE_ACCOUNT_URL are NOT set here —
      //    they are baked into the app code to simulate the anti-pattern
    ]
  }
}

// =============================================================================
// OUTPUTS
// These outputs are used by the deploy script to populate the hard-coded values
// in the app's config file (simulating a developer who copy-pasted endpoints)
// =============================================================================
output appServiceUrl string = appService.outputs.appServiceUrl
output appServiceName string = appService.outputs.appServiceName
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output storageAccountName string = storage.outputs.storageAccountName
output storageEndpoint string = storage.outputs.primaryEndpointBlob
output appInsightsConnectionString string = appInsights.outputs.connectionString
output appInsightsName string = appInsights.outputs.appInsightsName

// ⚠️  RISK SUMMARY (for documentation/tooling):
// - Hard-coded SQL FQDN in source code → breaks if SQL server is replaced
// - Hard-coded Storage endpoint in source code → breaks if storage account is renamed/migrated
// - No DNS alias → no abstraction layer for migration
// - Non-zonal App Service Plan → plan must be replaced (not updated) for ZR
