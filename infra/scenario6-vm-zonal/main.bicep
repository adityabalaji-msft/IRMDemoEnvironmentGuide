// =============================================================================
// SCENARIO 6: Zone-Pinned VM (HIGH RISK)
// =============================================================================
// Single VM pinned to one availability zone running the combined app.
// Connects to Azure SQL and Storage Account.
// 🎯 Purpose: Show that a zone-pinned VM has NO failover —
//             if the zone goes down, the entire app is unreachable.
// =============================================================================

targetScope = 'resourceGroup'

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region')
param location string = resourceGroup().location

@description('Base name prefix')
param baseName string = 'zr-vm-zonal'

@description('Microsoft Entra admin login name (UPN or group display name)')
param entraAdminLogin string

@description('Microsoft Entra admin object ID (user or group)')
param entraAdminObjectId string

@description('Deploy a new SQL Server+DB (false = reuse existing)')
param deploySql bool = true

@description('Existing SQL Server FQDN (used when deploySql=false)')
param existingSqlFqdn string = ''

@description('Existing SQL Database name (used when deploySql=false)')
param existingSqlDatabase string = ''

@description('Availability zone to pin the VM to (1, 2, or 3)')
param vmZone string = '1'

@description('VM size')
param vmSize string = 'Standard_DS2_v2'

@description('Admin username for the VM')
param adminUsername string = 'azureuser'

@description('SSH public key for VM access')
@secure()
param sshPublicKey string

var uniqueSuffix = uniqueString(resourceGroup().id)
var tags = {
  scenario: 'scenario6-vm-zonal'
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

// --- Storage (for app assets) ---
module storage '../modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    name: 'zrvmstor${uniqueSuffix}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
  }
}

// --- SQL Database (conditional) ---
module sqlDb '../modules/sqldb.bicep' = if (deploySql) {
  name: 'sql-deploy'
  params: {
    name: baseName
    location: location
    tags: tags
    uniqueSuffix: uniqueSuffix
    entraAdminLogin: entraAdminLogin
    entraAdminObjectId: entraAdminObjectId
  }
}

// --- Network resources ---
resource vnet 'Microsoft.Network/virtualNetworks@2023-04-01' = {
  name: '${baseName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2023-04-01' = {
  name: '${baseName}-pip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  zones: [vmZone]
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-04-01' = {
  name: '${baseName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowSSH'
        properties: {
          priority: 1000
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '22'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowHTTP'
        properties: {
          priority: 1001
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '8080'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowWorkerHTTP'
        properties: {
          priority: 1002
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '8081'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-04-01' = {
  name: '${baseName}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: vnet.properties.subnets[0].id
          }
          publicIPAddress: {
            id: publicIp.id
          }
          privateIPAllocationMethod: 'Dynamic'
        }
      }
    ]
    networkSecurityGroup: {
      id: nsg.id
    }
  }
}

// --- Zone-Pinned VM ---
resource vm 'Microsoft.Compute/virtualMachines@2023-07-01' = {
  name: '${baseName}-vm'
  location: location
  tags: union(tags, {
    'zr-zone-pinned': vmZone
    'zr-risk': 'high-single-zone'
  })
  zones: [vmZone]
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName: '${baseName}-vm'
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}

// --- Custom Script Extension to install Node.js and app ---
resource vmExtension 'Microsoft.Compute/virtualMachines/extensions@2023-07-01' = {
  parent: vm
  name: 'installApp'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    settings: {
      skipDos2Unix: false
    }
    protectedSettings: {
      script: base64(loadTextContent('cloud-init.sh'))
    }
  }
}

// --- Worker VM: Public IP, NIC, VM, Extension ---
resource workerPublicIp 'Microsoft.Network/publicIPAddresses@2023-04-01' = {
  name: '${baseName}-worker-pip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  zones: [vmZone]
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource workerNic 'Microsoft.Network/networkInterfaces@2023-04-01' = {
  name: '${baseName}-worker-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: vnet.properties.subnets[0].id
          }
          publicIPAddress: {
            id: workerPublicIp.id
          }
          privateIPAllocationMethod: 'Dynamic'
        }
      }
    ]
    networkSecurityGroup: {
      id: nsg.id
    }
  }
}

resource workerVm 'Microsoft.Compute/virtualMachines@2023-07-01' = {
  name: '${baseName}-worker'
  location: location
  tags: union(tags, {
    'zr-zone-pinned': vmZone
    'zr-risk': 'high-single-zone'
    'zr-role': 'worker'
  })
  zones: [vmZone]
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName: '${baseName}-worker'
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: workerNic.id
        }
      ]
    }
  }
}

resource workerVmExtension 'Microsoft.Compute/virtualMachines/extensions@2023-07-01' = {
  parent: workerVm
  name: 'installWorkerApp'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    settings: {
      skipDos2Unix: false
    }
    protectedSettings: {
      script: base64(loadTextContent('cloud-init-worker.sh'))
    }
  }
}

// =============================================================================
// OUTPUTS
// =============================================================================
output vmName string = vm.name
output vmPublicIp string = publicIp.properties.ipAddress
output vmZone string = vmZone
output vmPrincipalId string = vm.identity.principalId
output workerVmName string = workerVm.name
output workerVmPublicIp string = workerPublicIp.properties.ipAddress
output workerVmPrincipalId string = workerVm.identity.principalId
output sqlServerFqdn string = deploySql ? sqlDb.outputs.sqlServerFqdn : existingSqlFqdn
output sqlDatabaseName string = deploySql ? sqlDb.outputs.sqlDatabaseName : existingSqlDatabase
output storageEndpoint string = storage.outputs.primaryEndpointBlob
output storageAccountName string = storage.outputs.storageAccountName
output appInsightsConnectionString string = appInsights.outputs.connectionString
