// =============================================================================
// SCENARIO 6-ASR: Zone-Pinned VM with Azure Site Recovery
// =============================================================================
// Deploys a COPY of scenario 6 resources (VMs, VNet, SQL, Storage) into a NEW
// resource group in the same subscription, then configures an ASR vault to
// replicate both VMs from the source zone to a target zone.
//
// 🎯 Purpose: Demonstrate ASR zone-to-zone replication as a DR strategy for
//             zone-pinned VMs.  After failover, the post-failover script
//             restores connectivity (public IP, DNS, worker URL, SQL AD admin).
// =============================================================================

targetScope = 'resourceGroup'

// ── Parameters ──────────────────────────────────────────────────────────────

@description('Deployment environment tag')
param environment string = 'demo'

@description('Azure region (must support availability zones)')
param location string = resourceGroup().location

@description('Base name prefix for all resources')
param baseName string = 'zr-vm-asr'

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

@description('Source availability zone for VMs (1, 2, or 3)')
param sourceZone string = '1'

@description('Target availability zone for ASR replication (1, 2, or 3)')
param targetZone string = '2'

@description('VM size')
param vmSize string = 'Standard_DS2_v2'

@description('Admin username for the VMs')
param adminUsername string = 'azureuser'

@description('SSH public key for VM access')
@secure()
param sshPublicKey string

// ── Variables ───────────────────────────────────────────────────────────────

var uniqueSuffix = uniqueString(resourceGroup().id)
var tags = {
  scenario: 'scenario6-vm-asr'
  environment: environment
  riskLevel: 'medium'
  drStrategy: 'asr-zone-to-zone'
}

// ── Application Insights ────────────────────────────────────────────────────

module appInsights '../modules/appinsights.bicep' = {
  name: 'appInsights-deploy'
  params: {
    name: '${baseName}-ai'
    location: location
    tags: tags
  }
}

// ── Storage (for app assets) ────────────────────────────────────────────────

module storage '../modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    name: 'zrvmasrstor${uniqueSuffix}'
    location: location
    tags: tags
    skuName: 'Standard_LRS'
  }
}

// ── SQL Database (conditional) ──────────────────────────────────────────────

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

// ── Networking ──────────────────────────────────────────────────────────────

resource vnet 'Microsoft.Network/virtualNetworks@2023-04-01' = {
  name: '${baseName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.1.0.0/16']
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.1.1.0/24'
        }
      }
    ]
  }
}

// Private DNS Zone for inter-VM communication (survives ASR failover)
resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'scenario6asr.internal'
  location: 'global'
  tags: tags
}

resource privateDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: '${baseName}-vnet-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnet.id
    }
    registrationEnabled: true
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

// ── Main VM (zone-pinned) ───────────────────────────────────────────────────

resource publicIp 'Microsoft.Network/publicIPAddresses@2023-04-01' = {
  name: '${baseName}-pip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  zones: [sourceZone]
  properties: {
    publicIPAllocationMethod: 'Static'
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

resource vm 'Microsoft.Compute/virtualMachines@2023-07-01' = {
  name: '${baseName}-vm'
  location: location
  tags: union(tags, {
    'zr-zone-pinned': sourceZone
    'zr-asr-target-zone': targetZone
    'zr-risk': 'medium-asr-protected'
  })
  zones: [sourceZone]
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
        version: '22.04.202402080'
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
      script: base64(loadTextContent('../scenario6-vm-zonal/cloud-init.sh'))
    }
  }
}

// ── Worker VM (zone-pinned) ─────────────────────────────────────────────────

resource workerPublicIp 'Microsoft.Network/publicIPAddresses@2023-04-01' = {
  name: '${baseName}-worker-pip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  zones: [sourceZone]
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
    'zr-zone-pinned': sourceZone
    'zr-asr-target-zone': targetZone
    'zr-risk': 'medium-asr-protected'
    'zr-role': 'worker'
  })
  zones: [sourceZone]
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
        version: '22.04.202402080'
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
      script: base64(loadTextContent('../scenario6-vm-zonal/cloud-init-worker.sh'))
    }
  }
}

// ── Azure Site Recovery ─────────────────────────────────────────────────────

// Recovery Services Vault
resource rsVault 'Microsoft.RecoveryServices/vaults@2023-06-01' = {
  name: '${baseName}-rsv'
  location: location
  tags: tags
  sku: {
    name: 'RS0'
    tier: 'Standard'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

// ASR Fabric — single fabric per region for zone-to-zone replication
resource asrFabric 'Microsoft.RecoveryServices/vaults/replicationFabrics@2023-06-01' = {
  parent: rsVault
  name: '${location}-fabric'
  properties: {
    customDetails: {
      instanceType: 'Azure'
      location: location
    }
  }
}

// Source protection container (source zone)
resource asrContainerSource 'Microsoft.RecoveryServices/vaults/replicationFabrics/replicationProtectionContainers@2023-06-01' = {
  parent: asrFabric
  name: '${location}-source-container'
  properties: {}
}

// Target protection container (target zone — same fabric, different container)
resource asrContainerTarget 'Microsoft.RecoveryServices/vaults/replicationFabrics/replicationProtectionContainers@2023-06-01' = {
  parent: asrFabric
  name: '${location}-target-container'
  properties: {}
}

// Replication policy (24-hour recovery point retention, 5-min app-consistent snapshots)
resource asrPolicy 'Microsoft.RecoveryServices/vaults/replicationPolicies@2023-06-01' = {
  parent: rsVault
  name: '${baseName}-repl-policy'
  properties: {
    providerSpecificInput: {
      instanceType: 'A2A'
      multiVmSyncStatus: 'Enable'
      recoveryPointHistory: 1440    // 24 hours in minutes
      appConsistentFrequencyInMinutes: 60
      crashConsistentFrequencyInMinutes: 5
    }
  }
}

// Container mapping (source → target)
resource asrContainerMapping 'Microsoft.RecoveryServices/vaults/replicationFabrics/replicationProtectionContainers/replicationProtectionContainerMappings@2023-06-01' = {
  parent: asrContainerSource
  name: '${baseName}-source-to-target'
  properties: {
    targetProtectionContainerId: asrContainerTarget.id
    policyId: asrPolicy.id
    providerSpecificInput: {
      instanceType: 'A2A'
    }
  }
}

// Reverse container mapping (target → source, needed for failback)
resource asrContainerMappingReverse 'Microsoft.RecoveryServices/vaults/replicationFabrics/replicationProtectionContainers/replicationProtectionContainerMappings@2023-06-01' = {
  parent: asrContainerTarget
  name: '${baseName}-target-to-source'
  properties: {
    targetProtectionContainerId: asrContainerSource.id
    policyId: asrPolicy.id
    providerSpecificInput: {
      instanceType: 'A2A'
    }
  }
}

// Cache storage account (used by ASR during replication)
resource asrCacheStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'asrcache${uniqueSuffix}'
  location: location
  tags: union(tags, { purpose: 'asr-cache' })
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

// =============================================================================
// OUTPUTS
// =============================================================================

// VM outputs
output vmName string = vm.name
output vmResourceId string = vm.id
output vmPublicIp string = publicIp.properties.ipAddress
output vmZone string = sourceZone
output vmPrincipalId string = vm.identity.principalId
output workerVmName string = workerVm.name
output workerVmResourceId string = workerVm.id
output workerVmPublicIp string = workerPublicIp.properties.ipAddress
output workerVmPrincipalId string = workerVm.identity.principalId

// SQL / Storage outputs
output sqlServerFqdn string = deploySql ? sqlDb.outputs.sqlServerFqdn : existingSqlFqdn
output sqlDatabaseName string = deploySql ? sqlDb.outputs.sqlDatabaseName : existingSqlDatabase
output storageEndpoint string = storage.outputs.primaryEndpointBlob
output storageAccountName string = storage.outputs.storageAccountName
output appInsightsConnectionString string = appInsights.outputs.connectionString

// DNS outputs
output privateDnsZone string = privateDnsZone.name
output workerDnsName string = '${workerVm.properties.osProfile.computerName}.${privateDnsZone.name}'

// ASR outputs
output asrVaultName string = rsVault.name
output asrVaultId string = rsVault.id
output asrPolicyName string = asrPolicy.name
output asrFabricName string = asrFabric.name
output asrSourceContainerId string = asrContainerSource.id
output asrTargetContainerId string = asrContainerTarget.id
output asrCacheStorageId string = asrCacheStorage.id
output targetZone string = targetZone
