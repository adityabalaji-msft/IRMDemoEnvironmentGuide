// =============================================================================
// SCENARIO 5: App Service Plan Replacement (HIGH RISK)
// =============================================================================
// ❌ App deployed on a non-zonal Basic (B1) plan
// ❌ App Service Plan does NOT support zone redundancy — requires full replacement
// ❌ On plan replacement, all app settings + bindings must be re-validated
// 🎯 Purpose: Demonstrate that resource replacement (not update) is needed for ZR,
//             and that endpoint/config must be validated after migration
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix')
param baseName string = 'zr-replace'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

@description('If true, deploys the REPLACEMENT (zone-redundant P1v3) plan instead of original B1')
param deployReplacement bool = false

var tags = {
  scenario: 'scenario5-replacement'
  environment: environment
  riskLevel: 'high'
  planType: deployReplacement ? 'replacement-p1v3-zr' : 'original-b1-nonzonal'
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

// --- Storage ---
module storage '../modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    name: '${replace('${baseName}stor', '-', '')}${uniqueString(resourceGroup().id)}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
  }
}

// --- SQL ---
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

// ============================================================================
// ORIGINAL DEPLOYMENT: Non-zonal Basic plan (B1)
// This represents the "before" state — not capable of zone redundancy
// ============================================================================
module appServiceOriginal '../modules/appservice.bicep' = if (!deployReplacement) {
  name: 'appservice-original-deploy'
  params: {
    name: '${baseName}-checkout'
    location: location
    tags: union(tags, { planState: 'original' })
    planSku: 'F1'             // ❌ F1 cannot be made zone-redundant
    zoneRedundant: false
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    appSettings: [
      {
        name: 'SQL_SERVER'
        value: sql.outputs.sqlServerFqdn
      }
      {
        name: 'SQL_DATABASE'
        value: sql.outputs.sqlDatabaseName
      }
      {
        name: 'STORAGE_ACCOUNT_URL'
        value: storage.outputs.primaryEndpointBlob
      }
      {
        name: 'SCENARIO'
        value: 'scenario5-original'
      }
      {
        name: 'PLAN_TYPE'
        value: 'original'
      }
      {
        name: 'IS_ZONE_REDUNDANT'
        value: 'false'
      }
      {
        name: 'BACKEND_URL'
        value: 'https://${baseName}-checkout.azurewebsites.net'
      }
    ]
  }
}

// ============================================================================
// REPLACEMENT DEPLOYMENT: Zone-redundant P1v3 plan
// Run with: deployReplacement=true
// Simulates what happens when you must fully replace the plan — a new resource
// is created, the app URL changes, and all downstream config must be updated.
// ============================================================================
module appServiceReplacement '../modules/appservice.bicep' = if (deployReplacement) {
  name: 'appservice-replacement-deploy'
  params: {
    // ⚠️ Different name = new resource = new URL = downstream config must update!
    name: '${baseName}-checkout-zr'
    location: location
    tags: union(tags, { planState: 'replacement' })
    planSku: 'P1v3'           // ✅ P1v3 supports zone redundancy
    zoneRedundant: true
    runtimeStack: 'NODE|18-lts'
    appInsightsConnectionString: appInsights.outputs.connectionString
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    appSettings: [
      {
        name: 'SQL_SERVER'
        value: sql.outputs.sqlServerFqdn
      }
      {
        name: 'SQL_DATABASE'
        value: sql.outputs.sqlDatabaseName
      }
      {
        name: 'STORAGE_ACCOUNT_URL'
        value: storage.outputs.primaryEndpointBlob
      }
      {
        name: 'SCENARIO'
        value: 'scenario5-replacement'
      }
      {
        name: 'PLAN_TYPE'
        value: 'replacement'
      }
      {
        name: 'IS_ZONE_REDUNDANT'
        value: 'true'
      }
      {
        // New URL — any system pointing to the old URL must be updated!
        name: 'BACKEND_URL'
        value: 'https://${baseName}-checkout-zr.azurewebsites.net'
      }
    ]
  }
}

// =============================================================================
// OUTPUTS
// =============================================================================
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output storageAccountName string = storage.outputs.storageAccountName
output appInsightsName string = appInsights.outputs.appInsightsName
output appInsightsConnectionString string = appInsights.outputs.connectionString

// URLs differ depending on which plan was deployed
output originalAppUrl string = !deployReplacement ? appServiceOriginal.outputs.appServiceUrl : 'NOT_DEPLOYED'
output replacementAppUrl string = deployReplacement ? appServiceReplacement.outputs.appServiceUrl : 'NOT_DEPLOYED_YET'
output replacementAppName string = deployReplacement ? appServiceReplacement.outputs.appServiceName : 'NOT_DEPLOYED_YET'
