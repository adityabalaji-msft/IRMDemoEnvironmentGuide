// Module: Azure SQL Database
// Creates SQL Server + Database with optional zone redundancy
// Uses Microsoft Entra-only authentication (required by policy)

@description('Base name — server will be named <name>-<suffix>-sqlsvr, db will be <name>-db')
param name string

@description('Azure region')
param location string = resourceGroup().location

@description('Resource tags')
param tags object = {}

@description('Unique suffix for globally unique naming (e.g. uniqueString(resourceGroup().id))')
param uniqueSuffix string

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

@description('Database SKU/tier')
param databaseSku object = {
  name: 'GP_Gen5_2'
  tier: 'GeneralPurpose'
  family: 'Gen5'
  capacity: 2
}

@description('Enable zone redundancy for the database')
param zoneRedundant bool = false

@description('Enable public network access (disable for production)')
param publicNetworkAccess bool = true

// SQL Server — Entra-only authentication (no SQL auth)
resource sqlServer 'Microsoft.Sql/servers@2022-05-01-preview' = {
  name: '${name}-${uniqueSuffix}-sqlsvr'
  location: location
  tags: tags
  properties: {
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    minimalTlsVersion: '1.2'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: entraAdminLogin
      sid: entraAdminObjectId
      tenantId: tenant().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

// Allow Azure services to access the SQL server (for App Service)
resource sqlServerFirewallRuleAzure 'Microsoft.Sql/servers/firewallRules@2022-05-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// SQL Database
resource sqlDatabase 'Microsoft.Sql/servers/databases@2022-05-01-preview' = {
  parent: sqlServer
  name: '${name}-db'
  location: location
  tags: tags
  sku: databaseSku
  properties: {
    zoneRedundant: zoneRedundant
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648 // 2 GB
  }
}

// Outputs
output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output sqlServerId string = sqlServer.id
