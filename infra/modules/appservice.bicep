// Module: App Service Plan + Web App
// Supports both standard and zone-redundant configurations

@description('Name of the App Service')
param name string

@description('Azure region')
param location string = resourceGroup().location

@description('Resource tags')
param tags object = {}

@description('App Service Plan SKU — use P1v3/P2v3/P3v3 for zone redundancy')
param planSku string = 'F1'

@description('Enable zone redundancy (requires P1v3+ SKU)')
param zoneRedundant bool = false

@description('Runtime stack, e.g. NODE|18-lts, PYTHON|3.11')
param runtimeStack string = 'NODE|18-lts'

@description('App settings to inject as environment variables')
param appSettings array = []

@description('Application Insights connection string')
param appInsightsConnectionString string = ''

@description('Application Insights instrumentation key')
param appInsightsInstrumentationKey string = ''

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: planSku
    capacity: zoneRedundant ? 3 : 1
  }
  properties: {
    zoneRedundant: zoneRedundant
  }
}

// Combine base app settings with AppInsights settings
var baseAppSettings = [
  {
    name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
    value: appInsightsInstrumentationKey
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsightsConnectionString
  }
  {
    name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
    value: '~3'
  }
  {
    name: 'WEBSITE_NODE_DEFAULT_VERSION'
    value: '~18'
  }
]

var allAppSettings = concat(baseAppSettings, appSettings)

// Web App
resource webApp 'Microsoft.Web/sites@2022-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: runtimeStack
      appSettings: allAppSettings
      http20Enabled: true
      minTlsVersion: '1.2'
    }
  }
}

// Outputs
output appServiceName string = webApp.name
output appServiceId string = webApp.id
output appServiceUrl string = 'https://${webApp.properties.defaultHostName}'
output defaultHostName string = webApp.properties.defaultHostName
output appServicePlanId string = appServicePlan.id
output appServicePlanName string = appServicePlan.name
