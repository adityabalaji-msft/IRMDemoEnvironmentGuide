# Environment Setup & Deployment Guide

> This document covers how to deploy and configure the demo scenarios from scratch. For the demo walkthrough, see the main [README.md](README.md).

---

## Prerequisites

- Azure CLI (`az`) — [Install](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
- Bicep CLI — `az bicep install`
- Node.js 18+
- k6 (optional, for load testing) — [Install](https://k6.io/docs/get-started/installation/)

### Storage Account Key

The AKS backend app (`apps/scenario4-backend`) requires a **Storage Account access key** in its Kubernetes ConfigMap. The key has been removed from source control for security.

Before deploying scenario 4, update `apps/scenario4-backend/k8s/configmap.yaml`:

```yaml
STORAGE_ACCOUNT_KEY: "<REPLACE_WITH_STORAGE_KEY>"
```

Retrieve the key with:

```bash
az storage account keys list \
  --account-name zraksstoryerto2m6texc4 \
  --resource-group zr-demo-rg-4 \
  --query "[0].value" -o tsv
```

> ⚠️ **Never commit storage account keys to source control.** Consider migrating to Managed Identity + RBAC (Storage Blob Data Contributor) for production use.

---

## 🗂 Repository Structure

```
.
├── README.md
├── infra/
│   ├── modules/                  # Reusable Bicep modules
│   │   ├── appinsights.bicep
│   │   ├── appservice.bicep
│   │   ├── sqldb.bicep
│   │   ├── storage.bicep
│   │   ├── aks.bicep
│   │   ├── frontdoor.bicep
│   │   └── dns.bicep
│   ├── scenario1-safe/           # Safe low-risk deployment
│   ├── scenario2-hardcoded/      # Hard-coded endpoints (risky)
│   ├── scenario3-shared/         # Shared infra, blast radius
│   ├── scenario4-aks/            # AKS microservices
│   └── scenario5-replacement/    # App Service plan replacement
├── apps/
│   ├── scenario1-safe-checkout/  # Safe checkout service
│   ├── scenario2-hardcoded/      # Bad config checkout service
│   ├── scenario3-checkout/       # Shared infra checkout
│   ├── scenario3-loyalty/        # Shared infra loyalty service
│   ├── scenario4-frontend/       # AKS frontend
│   ├── scenario4-backend/        # AKS backend API
│   └── scenario5-replacement/    # Replacement scenario app
├── scripts/
│   ├── deploy-all.sh             # Deploy all scenarios
│   ├── deploy-scenario.sh        # Deploy individual scenario
│   ├── teardown.sh               # Clean up all resources
│   └── load-gen/
│       ├── k6-load.js            # k6 load test script
│       └── simple-load.js        # Node.js simple load generator
└── docs/
    ├── scenarios.md              # Scenario descriptions & risk ratings
    ├── deployment-guide.md       # Full deployment instructions
    └── architecture.md           # Architecture diagrams
```

---

## 🎯 Scenarios Overview

| # | Name | Risk Level | Key Signal |
|---|------|-----------|------------|
| 1 | Safe Checkout Service | 🟢 LOW | DNS alias, env vars, clean dependencies |
| 2 | Hard-coded Checkout | 🔴 HIGH | Direct SQL/Storage endpoints in code |
| 3 | Shared Infra (Checkout + Loyalty) | 🟡 MEDIUM | Shared App Gateway, blast radius |
| 4 | AKS Microservices | 🟡 MEDIUM | ConfigMaps, runtime signals needed |
| 5 | App Service Plan Replacement | 🔴 HIGH | Non-zonal plan, endpoint re-validation needed |

---

## 🚀 Deployment

### 1. Login to Azure

```bash
az login
az account set --subscription "<YOUR_SUBSCRIPTION_ID>"
```

### 2. Deploy a Single Scenario

**Linux/macOS:**
```bash
chmod +x scripts/deploy-scenario.sh
./scripts/deploy-scenario.sh 1   # Deploy Scenario 1
```

**Windows (PowerShell):**
```powershell
bash scripts/deploy-scenario.sh 1   # Using WSL or Git Bash
```

### 3. Deploy All Scenarios

**Linux/macOS:**
```bash
chmod +x scripts/deploy-all.sh
./scripts/deploy-all.sh
```

**Windows (PowerShell):**
```powershell
bash scripts/deploy-all.sh   # Using WSL or Git Bash
```

> **Note:** Windows does not have a direct `chmod` equivalent. The recommended approach on Windows is to run scripts via **WSL** (`wsl bash scripts/deploy-scenario.sh`) or **Git Bash** where `chmod` works natively.

### 4. Generate Load

```bash
# Using k6
k6 run scripts/load-gen/k6-load.js

# Using Node.js
node scripts/load-gen/simple-load.js
```

---

## 📖 Documentation

- [Scenario Descriptions](docs/scenarios.md) — Risk details and what each scenario tests
- [Deployment Guide](docs/deployment-guide.md) — Step-by-step deployment instructions
- [Architecture](docs/architecture.md) — Architecture diagrams and dependency maps

---

## 🔧 Configuration

All scenarios use environment variables for configuration. Copy `.env.example` in each app directory and populate values after deployment.

```bash
# Example: apps/scenario1-safe-checkout/.env
APPINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
SQL_SERVER=myserver.database.windows.net   # DNS alias — safe!
STORAGE_ACCOUNT_URL=https://mystorageaccount.blob.core.windows.net
```
