extension radius

param environment string

@secure()
param registryPassword string

@secure()
param registryUsername string

@secure()
param sqlAdminPassword string

resource irmDemoEnvironmentGuideApp 'Radius.Core/applications@2025-08-01-preview' = {
  name: 'irm-demo-environment-guide'
  properties: {
    environment: environment
  }
}

resource sqlDb 'Radius.Data/sqlServerDatabases@2025-08-01-preview' = {
  name: 'sqlserver'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-backend/src/index.js#L73'
    database: 'zr-aks-db'
    password: sqlAdminPassword
    username: 'sqladmin'
  }
}

resource storage 'Radius.Storage/objectStorage@2025-08-01-preview' = {
  name: 'storage'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-frontend/src/index.js#L99'
    containerName: 'demo-data'
  }
}

// Do not change this Secret's name value from 'radius-ghcr-registry-creds'.
// The containerImages recipe looks up registry credentials by that fixed name.
resource registryCreds 'Radius.Security/secrets@2025-08-01-preview' = {
  name: 'radius-ghcr-registry-creds'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: '.radius/app.bicep#L45'
    data: {
      password: {
        value: registryPassword
      }
      username: {
        value: registryUsername
      }
    }
  }
}

resource sqlSecret 'Radius.Security/secrets@2025-08-01-preview' = {
  name: 'sql-secret'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-backend/k8s/deployment.yaml#L53'
    data: {
      password: {
        value: sqlAdminPassword
      }
    }
  }
}

resource backendImage 'Radius.Compute/containerImages@2025-08-01-preview' = {
  name: 'backend-image'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    build: {
      platforms: [
        'linux/amd64'
      ]
      source: 'git::https://github.com/adityabalaji-msft/IRMDemoEnvironmentGuide.git//apps/scenario4-backend?ref=fcfdac4dda21e00c60e35f3ed46dda9f88d1921d'
    }
    codeReference: 'apps/scenario4-backend/Dockerfile'
    tag: 'fcfdac4dda21'
  }
  dependsOn: [
    registryCreds
  ]
}

resource frontendImage 'Radius.Compute/containerImages@2025-08-01-preview' = {
  name: 'frontend-image'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    build: {
      platforms: [
        'linux/amd64'
      ]
      source: 'git::https://github.com/adityabalaji-msft/IRMDemoEnvironmentGuide.git//apps/scenario4-frontend?ref=fcfdac4dda21e00c60e35f3ed46dda9f88d1921d'
    }
    codeReference: 'apps/scenario4-frontend/Dockerfile'
    tag: 'fcfdac4dda21'
  }
  dependsOn: [
    registryCreds
  ]
}

resource backendContainer 'Radius.Compute/containers@2025-08-01-preview' = {
  name: 'backend'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-backend/src/index.js#L233'
    containers: {
      backend: {
        env: {
          SQL_DATABASE: {
            value: 'zr-aks-db'
          }
          SQL_PASSWORD: {
            valueFrom: {
              secretKeyRef: {
                key: 'password'
                secretName: sqlSecret.name
              }
            }
          }
          SQL_SERVER: {
            value: sqlDb.properties.host
          }
          SQL_USER: {
            value: 'sqladmin'
          }
        }
        image: backendImage.properties.imageReference
        ports: {
          web: {
            containerPort: 8080
          }
        }
        readinessProbe: {
          httpGet: {
            path: '/health'
            port: 8080
          }
        }
      }
    }
    replicas: 3
  }
}

resource frontendContainer 'Radius.Compute/containers@2025-08-01-preview' = {
  name: 'frontend'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-frontend/src/index.js#L886'
    containers: {
      frontend: {
        env: {
          BACKEND_URL: {
            value: 'http://${backendContainer.properties.hosts.backend}:8080'
          }
          STORAGE_ACCOUNT_KEY: {
            valueFrom: {
              secretKeyRef: {
                key: 'accountKey'
                secretName: storage.properties.secrets.name
              }
            }
          }
          STORAGE_ACCOUNT_NAME: {
            value: storage.properties.accountName
          }
          STORAGE_ACCOUNT_URL: {
            value: storage.properties.endpoint
          }
        }
        image: frontendImage.properties.imageReference
        ports: {
          web: {
            containerPort: 8080
          }
        }
        readinessProbe: {
          httpGet: {
            path: '/health'
            port: 8080
          }
        }
      }
    }
    replicas: 3
  }
}

resource frontendRoute 'Radius.Compute/routes@2025-08-01-preview' = {
  name: 'frontend-route'
  properties: {
    environment: environment
    application: irmDemoEnvironmentGuideApp.id
    codeReference: 'apps/scenario4-frontend/k8s/deployment.yaml#L114'
    kind: 'HTTP'
    rules: [
      {
        destinationContainer: {
          containerName: 'frontend'
          containerPort: 8080
          resourceId: frontendContainer.id
        }
        matches: [
          {
            httpPath: '/'
          }
        ]
      }
    ]
  }
}
