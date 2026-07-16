// =============================================================================
// SCENARIO 3: Shared Infrastructure (MEDIUM-HIGH RISK — Blast Radius)
// =============================================================================
// Two apps share a single Azure Front Door instance and a Storage account.
// ✅ Apps themselves use env vars
// ❌ Shared Front Door — migrating/replacing it impacts BOTH apps simultaneously
// ❌ Shared Storage — operations on storage affect multiple services
// 🎯 Purpose: Detect shared resource blast radius during ZR migration
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix')
param baseName string = 'zr-shared'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

var tags = {
  scenario: 'scenario3-shared'
  environment: environment
  riskLevel: 'medium-high'
}

// =============================================================================
// SHARED INFRASTRUCTURE (the blast radius resources)
// =============================================================================

// ⚠️ SHARED: Single Application Insights instance for both apps
module sharedAppInsights '../modules/appinsights.bicep' = {
  name: 'shared-appInsights-deploy'
  params: {
    name: '${baseName}-shared-ai'
    location: location
    tags: union(tags, { shared: 'true' })
  }
}

// ⚠️ SHARED: Single Storage Account used by both checkout and loyalty
module sharedStorage '../modules/storage.bicep' = {
  name: 'shared-storage-deploy'
  params: {
    name: '${replace('${baseName}shared', '-', '')}${uniqueString(resourceGroup().id)}'
    location: location
    tags: union(tags, { shared: 'true' })
    skuName: 'Standard_LRS'
  }
}

// =============================================================================
// CHECKOUT SERVICE
// =============================================================================

module checkoutSql '../modules/sqldb.bicep' = {
  name: 'checkout-sql-deploy'
  params: {
    name: '${baseName}-checkout'
    location: location
    tags: union(tags, { service: 'checkout' })
    uniqueSuffix: uniqueString(resourceGroup().id)
    entraAdminLogin: entraAdminLogin
    entraAdminObjectId: entraAdminObjectId
  }
}

module checkoutApp '../modules/appservice.bicep' = {
  name: 'checkout-app-deploy'
  params: {
    name: '${baseName}-checkout'
    location: location
    tags: union(tags, { service: 'checkout' })
    planSku: 'F1'
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: sharedAppInsights.outputs.connectionString
    appInsightsInstrumentationKey: sharedAppInsights.outputs.instrumentationKey
    appSettings: [
      {
        name: 'SQL_SERVER'
        value: checkoutSql.outputs.sqlServerFqdn
      }
      {
        name: 'SQL_DATABASE'
        value: checkoutSql.outputs.sqlDatabaseName
      }
      {
        // ⚠️ SHARED: Both apps point to the same storage account
        name: 'STORAGE_ACCOUNT_URL'
        value: sharedStorage.outputs.primaryEndpointBlob
      }
      {
        name: 'SCENARIO'
        value: 'scenario3-checkout'
      }
    ]
  }
}

// =============================================================================
// LOYALTY SERVICE
// =============================================================================

module loyaltySql '../modules/sqldb.bicep' = {
  name: 'loyalty-sql-deploy'
  params: {
    name: '${baseName}-loyalty'
    location: location
    tags: union(tags, { service: 'loyalty' })
    uniqueSuffix: uniqueString(resourceGroup().id)
    entraAdminLogin: entraAdminLogin
    entraAdminObjectId: entraAdminObjectId
  }
}

module loyaltyApp '../modules/appservice.bicep' = {
  name: 'loyalty-app-deploy'
  params: {
    name: '${baseName}-loyalty'
    location: location
    tags: union(tags, { service: 'loyalty' })
    planSku: 'F1'
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: sharedAppInsights.outputs.connectionString
    appInsightsInstrumentationKey: sharedAppInsights.outputs.instrumentationKey
    appSettings: [
      {
        name: 'SQL_SERVER'
        value: loyaltySql.outputs.sqlServerFqdn
      }
      {
        name: 'SQL_DATABASE'
        value: loyaltySql.outputs.sqlDatabaseName
      }
      {
        // ⚠️ SHARED: Same storage account as checkout
        name: 'STORAGE_ACCOUNT_URL'
        value: sharedStorage.outputs.primaryEndpointBlob
      }
      {
        name: 'SCENARIO'
        value: 'scenario3-loyalty'
      }
    ]
  }
}

// =============================================================================
// SHARED FRONT DOOR
// ⚠️ Both checkout and loyalty are origins behind the SAME Front Door
// Replacing/updating Front Door impacts BOTH services simultaneously
// =============================================================================

module frontDoor '../modules/frontdoor.bicep' = {
  name: 'frontdoor-deploy'
  params: {
    name: '${baseName}-afd'
    tags: union(tags, { shared: 'true' })
    origins: [
      {
        name: 'checkout'
        hostName: checkoutApp.outputs.defaultHostName
      }
      {
        name: 'loyalty'
        hostName: loyaltyApp.outputs.defaultHostName
      }
    ]
  }
}

// =============================================================================
// OUTPUTS
// =============================================================================
output frontDoorUrl string = frontDoor.outputs.endpointUrl
output frontDoorName string = frontDoor.outputs.frontDoorName
output checkoutAppUrl string = checkoutApp.outputs.appServiceUrl
output loyaltyAppUrl string = loyaltyApp.outputs.appServiceUrl
output sharedStorageName string = sharedStorage.outputs.storageAccountName
output sharedAppInsightsName string = sharedAppInsights.outputs.appInsightsName
output checkoutSqlFqdn string = checkoutSql.outputs.sqlServerFqdn
output loyaltySqlFqdn string = loyaltySql.outputs.sqlServerFqdn

// ⚠️ BLAST RADIUS SUMMARY:
// Replacing Front Door → breaks BOTH checkout and loyalty routing simultaneously
// Replacing shared Storage → breaks BOTH apps' blob operations simultaneously
// Shared App Insights → dependency map shows both apps entangled
