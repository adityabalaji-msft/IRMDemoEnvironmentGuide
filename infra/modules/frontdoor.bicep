// Module: Azure Front Door (Standard tier)
// Used in Scenario 3 to demonstrate shared infrastructure blast radius

@description('Front Door profile name')
param name string

@description('Resource tags')
param tags object = {}

@description('List of origins to route traffic to')
param origins array = []
// Example origin: { name: 'checkout', hostName: 'myapp.azurewebsites.net' }

// Front Door Profile
resource frontDoorProfile 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: name
  location: 'global'
  tags: tags
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

// Endpoint
resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: frontDoorProfile
  name: '${name}-endpoint'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

// Origin Group
resource originGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: frontDoorProfile
  name: '${name}-og'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 60
    }
  }
}

// Origins
resource frontDoorOrigins 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = [for origin in origins: {
  parent: originGroup
  name: origin.name
  properties: {
    hostName: origin.hostName
    httpPort: 80
    httpsPort: 443
    originHostHeader: origin.hostName
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}]

// Route
resource frontDoorRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: frontDoorEndpoint
  name: 'default-route'
  dependsOn: [frontDoorOrigins]
  properties: {
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: ['Http', 'Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
}

// Outputs
output frontDoorId string = frontDoorProfile.id
output frontDoorName string = frontDoorProfile.name
output endpointHostName string = frontDoorEndpoint.properties.hostName
output endpointUrl string = 'https://${frontDoorEndpoint.properties.hostName}'
