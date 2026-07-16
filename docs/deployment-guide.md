# Deployment Guide

This guide shows how to deploy infrastructure, deploy applications, configure dependencies, generate traffic, and verify dependency maps.

## Prerequisites

- Azure CLI installed and logged in
- Bicep support (`az bicep install`)
- Node.js 18+
- Docker (for AKS image builds)
- kubectl (for AKS scenario)
- k6 (optional)

## 1) Login and Subscription

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
```

## 2) Deploy Infrastructure

### Single scenario

```bash
chmod +x scripts/deploy-scenario.sh
./scripts/deploy-scenario.sh 1 zr-demo-rg eastus
```

Repeat with scenarios `2`, `3`, `4`, `5`.

### All scenarios

```bash
chmod +x scripts/deploy-all.sh
./scripts/deploy-all.sh zr-demo-rg eastus
```

## 3) Deploy App Code

### App Service scenarios (1, 2, 3, 5)

From each app folder:

```bash
cd apps/scenario1-safe-checkout
npm install
zip -r app.zip .
az webapp deployment source config-zip \
  --resource-group zr-demo-rg \
  --name zr-safe-checkout \
  --src app.zip
```

Repeat for:

- `apps/scenario2-hardcoded` -> app name from scenario2 outputs
- `apps/scenario3-checkout` -> `zr-shared-checkout`
- `apps/scenario3-loyalty` -> `zr-shared-loyalty`
- `apps/scenario5-replacement` -> `zr-replace-checkout` (and later `zr-replace-checkout-zr`)

### AKS scenario (4)

1. Get AKS credentials:

```bash
az aks get-credentials --resource-group zr-demo-rg --name zr-aks-cluster
```

2. Build and push images to your ACR, then update image names in:

- `apps/scenario4-backend/k8s/deployment.yaml`
- `apps/scenario4-frontend/k8s/deployment.yaml`

3. Create Kubernetes secrets:

```bash
kubectl create secret generic sql-credentials --from-literal=password='<SQL_PASSWORD>'
kubectl create secret generic appinsights-secret --from-literal=connectionString='<APPINSIGHTS_CONNECTION_STRING>'
```

4. Apply manifests:

```bash
kubectl apply -f apps/scenario4-backend/k8s/configmap.yaml
kubectl apply -f apps/scenario4-backend/k8s/deployment.yaml
kubectl apply -f apps/scenario4-frontend/k8s/deployment.yaml
```

## 4) Verify Endpoints

### Scenario 1

```bash
curl https://zr-safe-checkout.azurewebsites.net/health
curl -X POST https://zr-safe-checkout.azurewebsites.net/checkout -H "Content-Type: application/json" -d '{"items":[{"productId":1,"qty":2}]}'
```

### Scenario 2

```bash
curl https://zr-risky-checkout.azurewebsites.net/dependencies
```

### Scenario 3

```bash
curl https://zr-shared-checkout.azurewebsites.net/health
curl https://zr-shared-loyalty.azurewebsites.net/health
```

### Scenario 4

```bash
kubectl get svc frontend-service
# Use EXTERNAL-IP and call:
curl http://<EXTERNAL_IP>/health
```

### Scenario 5

```bash
curl https://zr-replace-checkout.azurewebsites.net/migration-status
```

## 5) Generate Traffic (Populate App Insights Dependency Map)

### Using k6

```bash
k6 run scripts/load-gen/k6-load.js
```

Use `-e` flags to set actual URLs if names differ.

### Using simple Node.js script

```bash
node scripts/load-gen/simple-load.js
```

## 6) View Dependency Map in Azure Portal

For each Application Insights instance:

1. Open Azure Portal
2. Go to Application Insights resource
3. Select `Application Map`
4. Filter by recent time range (Last 30 minutes)
5. Observe outgoing dependencies:
   - SQL
   - Storage
   - HTTP dependencies

## 7) Failure Simulation and Risk Demonstration

### Hard-coded failure (Scenario 2)

1. Replace SQL server resource with new name/FQDN
2. Keep app code unchanged
3. Call `/checkout`
4. Observe failure due to stale hard-coded endpoint

### Shared blast radius (Scenario 3)

1. Stop/change shared Front Door route
2. Test checkout + loyalty endpoints
3. Both services impacted

### Replacement risk (Scenario 5)

1. Deploy original (`deployReplacement=false`)
2. Deploy replacement (`deployReplacement=true`)
3. Compare old vs new hostnames
4. Validate all downstream callers updated to new URL

## 8) Cleanup

```bash
chmod +x scripts/teardown.sh
./scripts/teardown.sh zr-demo-rg
```
