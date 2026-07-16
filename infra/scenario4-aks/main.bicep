// =============================================================================
// SCENARIO 4: AKS Microservices Workload (MEDIUM RISK)
// =============================================================================
// Frontend + Backend deployed to AKS
// Dependencies declared via ConfigMaps and environment variables
// Connects to Azure SQL (backend) and Storage (frontend)
// 🎯 Purpose: Show that control-plane alone (AKS resource) is insufficient —
//             runtime + config signals (ConfigMaps, service discovery) are needed
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix')
param baseName string = 'zr-aks'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

@description('AKS node count')
param aksNodeCount int = 3

var tags = {
  scenario: 'scenario4-aks'
  environment: environment
  riskLevel: 'medium'
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

// --- Storage (for frontend static assets / uploads) ---
module storage '../modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    name: '${replace('${baseName}stor', '-', '')}${uniqueString(resourceGroup().id)}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
  }
}

// --- SQL Database (for backend API) ---
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

// --- AKS Cluster ---
module aks '../modules/aks.bicep' = {
  name: 'aks-deploy'
  params: {
    name: '${baseName}-cluster'
    location: location
    tags: tags
    nodeCount: aksNodeCount
    availabilityZones: ['1', '2', '3']
    logAnalyticsWorkspaceId: appInsights.outputs.logAnalyticsWorkspaceId
  }
}

// =============================================================================
// OUTPUTS
// These are used by the k8s manifest generation script to populate ConfigMaps
// =============================================================================
output aksClusterName string = aks.outputs.clusterName
output aksClusterId string = aks.outputs.clusterId
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output storageEndpoint string = storage.outputs.primaryEndpointBlob
output storageAccountName string = storage.outputs.storageAccountName
output appInsightsConnectionString string = appInsights.outputs.connectionString
output appInsightsInstrumentationKey string = appInsights.outputs.instrumentationKey
output appInsightsName string = appInsights.outputs.appInsightsName
output logAnalyticsWorkspaceId string = appInsights.outputs.logAnalyticsWorkspaceId

// K8s manifest hint:
// After deployment, run: scripts/deploy-scenario.sh 4 --configure-k8s
// This will generate and apply the k8s ConfigMaps and Deployments with correct values
