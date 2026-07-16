// Module: Azure Storage Account

@description('Storage account name (globally unique, lowercase, 3-24 chars)')
param name string

@description('Azure region')
param location string = resourceGroup().location

@description('Resource tags')
param tags object = {}

@description('Storage SKU — Standard_ZRS for zonal, Standard_LRS for non-zonal')
param skuName string = 'Standard_LRS'

@description('Enable blob public access (false for production)')
param allowBlobPublicAccess bool = false

// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2022-09-01' = {
  name: name
  location: location
  tags: union(tags, { DisableLocalAuth: 'true' })
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: allowBlobPublicAccess
    allowSharedKeyAccess: false
    networkAcls: {
      defaultAction: 'Allow' // Restrict in production
      bypass: 'AzureServices'
    }
  }
}

// Blob Service
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2022-09-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

// Default container for demo data
resource defaultContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2022-09-01' = {
  parent: blobService
  name: 'demo-data'
  properties: {
    publicAccess: 'None'
  }
}

// Outputs
output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output primaryEndpointBlob string = storageAccount.properties.primaryEndpoints.blob
output primaryEndpointFile string = storageAccount.properties.primaryEndpoints.file
