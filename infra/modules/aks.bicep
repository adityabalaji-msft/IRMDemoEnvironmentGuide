// Module: Azure Kubernetes Service (AKS) Cluster

@description('AKS cluster name')
param name string

@description('Azure region')
param location string = resourceGroup().location

@description('Resource tags')
param tags object = {}

@description('Kubernetes version')
param kubernetesVersion string = '1.33'

@description('VM size for the default node pool')
param nodeVmSize string = 'Standard_DS2_v2'

@description('Number of nodes in the system pool')
param nodeCount int = 3

@description('VM size for the user node pool')
param userNodeVmSize string = 'Standard_DS2_v2'

@description('Number of nodes in the user pool (use multiple of 3 for zone spread)')
param userNodeCount int = 3

@description('Enable zone redundancy for the node pools')
param availabilityZones array = []

@description('DNS prefix for the cluster')
param dnsPrefix string = name

@description('Log Analytics Workspace ID for monitoring')
param logAnalyticsWorkspaceId string = ''

// AKS Cluster
resource aksCluster 'Microsoft.ContainerService/managedClusters@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: dnsPrefix
    kubernetesVersion: kubernetesVersion
    enableRBAC: true
    agentPoolProfiles: [
      {
        name: 'system'
        count: nodeCount
        vmSize: nodeVmSize
        osType: 'Linux'
        mode: 'System'
        availabilityZones: !empty(availabilityZones) ? availabilityZones : null
        enableAutoScaling: false
        type: 'VirtualMachineScaleSets'
      }
      {
        name: 'userpool'
        count: userNodeCount
        vmSize: userNodeVmSize
        osType: 'Linux'
        mode: 'User'
        availabilityZones: !empty(availabilityZones) ? availabilityZones : null
        enableAutoScaling: true
        minCount: 2
        maxCount: 6
        type: 'VirtualMachineScaleSets'
        nodeTaints: []
        nodeLabels: {
          workload: 'app'
        }
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
    }
    addonProfiles: {
      omsagent: {
        enabled: !empty(logAnalyticsWorkspaceId)
        config: empty(logAnalyticsWorkspaceId) ? null : {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
    }
    apiServerAccessProfile: {
      enablePrivateCluster: false // Public for demo; use private in production
    }
  }
}

// Outputs
output clusterName string = aksCluster.name
output clusterId string = aksCluster.id
output clusterFqdn string = aksCluster.properties.fqdn
output kubeletIdentityObjectId string = aksCluster.properties.identityProfile.kubeletidentity.objectId
output clusterIdentityPrincipalId string = aksCluster.identity.principalId
