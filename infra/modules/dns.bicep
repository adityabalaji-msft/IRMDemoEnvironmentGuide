// Module: Azure Private DNS Zone
// Used for creating DNS aliases — key for safe/abstracted resource references

@description('DNS zone name, e.g. internal.contoso.com')
param zoneName string

@description('Resource tags')
param tags object = {}

@description('CNAME records to create — for alias/abstraction pattern')
param cnameRecords array = []
// Example: [{ name: 'sql-alias', cname: 'myserver.database.windows.net' }]

@description('Virtual network IDs to link this DNS zone to')
param vnetLinks array = []
// Example: [{ name: 'my-link', vnetId: '/subscriptions/.../virtualNetworks/myvnet' }]

// Private DNS Zone
resource dnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: zoneName
  location: 'global'
  tags: tags
}

// CNAME Records
resource cnameRecord 'Microsoft.Network/privateDnsZones/CNAME@2020-06-01' = [for record in cnameRecords: {
  parent: dnsZone
  name: record.name
  properties: {
    ttl: 300
    cnameRecord: {
      cname: record.cname
    }
  }
}]

// VNet Links
resource vnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for link in vnetLinks: {
  parent: dnsZone
  name: link.name
  location: 'global'
  properties: {
    virtualNetwork: {
      id: link.vnetId
    }
    registrationEnabled: false
  }
}]

// Outputs
output dnsZoneId string = dnsZone.id
output dnsZoneName string = dnsZone.name
