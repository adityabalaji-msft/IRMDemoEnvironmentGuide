# Architecture Overview

This repository implements five migration risk scenarios for zonal resiliency analysis.

## Scenario 1 (Safe)

```mermaid
graph LR
  U[User Traffic] --> A1[App Service: Safe Checkout]
  A1 --> SQL1[Azure SQL DB]
  A1 --> ST1[Azure Storage]
  A1 --> AI1[App Insights]
```

Notes:
- Dependencies configured via environment variables
- No hard-coded Azure endpoint literals

## Scenario 2 (Hard-coded)

```mermaid
graph LR
  U[User Traffic] --> A2[App Service: Hardcoded Checkout]
  A2 --> SQL2[Azure SQL DB FQDN hard-coded]
  A2 --> ST2[Storage URL hard-coded]
  A2 --> AI2[App Insights]
```

Notes:
- Direct endpoint literals in source code
- High failure risk when resources are replaced

## Scenario 3 (Shared Infra)

```mermaid
graph LR
  U[User Traffic] --> FD[Shared Front Door]
  FD --> C3[Checkout App]
  FD --> L3[Loyalty App]
  C3 --> SQL3C[Checkout SQL]
  L3 --> SQL3L[Loyalty SQL]
  C3 --> ST3[Shared Storage]
  L3 --> ST3
  C3 --> AI3[Shared App Insights]
  L3 --> AI3
```

Notes:
- Front Door and Storage are shared blast-radius resources

## Scenario 4 (AKS)

```mermaid
graph LR
  U[User Traffic] --> FE4[AKS Frontend Service]
  FE4 --> BE4[AKS Backend Service]
  BE4 --> SQL4[Azure SQL DB]
  FE4 --> ST4[Azure Storage]
  FE4 --> AI4[App Insights]
  BE4 --> AI4
```

Notes:
- Dependency config in ConfigMaps/Secrets
- Runtime telemetry needed to validate actual use

## Scenario 5 (Replacement)

```mermaid
graph LR
  U[User Traffic] --> O5[Original App Service B1 Non-Zonal]
  U --> R5[Replacement App Service P1v3 Zonal]
  O5 --> SQL5[Azure SQL]
  R5 --> SQL5
  O5 --> ST5[Storage]
  R5 --> ST5
  O5 --> AI5[App Insights]
  R5 --> AI5
```

Notes:
- Plan replacement creates new hostname
- Downstream callers must be updated during cutover
