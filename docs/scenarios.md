# Scenario Catalog and Risk Classification

This document describes each scenario, why it exists, and what dependency/risk signals it should produce.

## Scenario 1: Safe Checkout Service

- Infra: App Service + Azure SQL + Storage + Application Insights
- App: `apps/scenario1-safe-checkout`
- Risk: **LOW**
- Signals:
  - SQL and Storage endpoints are injected through environment variables
  - No hard-coded Azure endpoint literals in source code
  - Dependency map should show clean links: App -> SQL, App -> Storage
- Migration expectation:
  - Safe for zonal migration with minimal app code impact
  - Validate only app settings and connectivity post-cutover

## Scenario 2: Hard-coded Dependency Checkout

- Infra: Same service shape as Scenario 1
- App: `apps/scenario2-hardcoded`
- Risk: **HIGH**
- Signals:
  - Hard-coded SQL FQDN (`*.database.windows.net`) in source code
  - Hard-coded Storage endpoint (`*.blob.core.windows.net`) in source code
  - No DNS abstraction layer
- Migration expectation:
  - Replacing SQL/Storage resource names likely breaks app immediately
  - Requires code update + redeploy

## Scenario 3: Shared Infrastructure Blast Radius

- Infra: Two app services (checkout + loyalty) with shared Front Door and shared Storage
- Apps:
  - `apps/scenario3-checkout`
  - `apps/scenario3-loyalty`
- Risk: **MEDIUM-HIGH**
- Signals:
  - Shared Front Door origin group points to both apps
  - Shared Storage endpoint appears in both app configurations
  - Dependency map reveals multi-app coupling through shared resources
- Migration expectation:
  - Change on shared resource impacts multiple apps simultaneously
  - Requires coordinated deployment/change window

## Scenario 4: AKS Microservices

- Infra: AKS + SQL + Storage + Application Insights
- Apps:
  - `apps/scenario4-frontend`
  - `apps/scenario4-backend`
- Risk: **MEDIUM**
- Signals:
  - Backend SQL endpoint stored in Kubernetes ConfigMap
  - Frontend backend URL uses Kubernetes internal DNS (`backend-service`)
  - Storage endpoint also provided through ConfigMap
  - Runtime telemetry is needed to confirm real dependency use
- Migration expectation:
  - Cluster resource graph alone is not enough
  - Must inspect ConfigMaps/Secrets + runtime dependency traces

## Scenario 5: App Service Plan Replacement

- Infra: Original B1 plan (non-zonal) and optional replacement P1v3 zonal deployment
- App: `apps/scenario5-replacement`
- Risk: **HIGH** in original state, **LOWER** after replacement and validation
- Signals:
  - Original plan not zonally capable
  - Replacement creates a new app hostname
  - Downstream systems may still point to old URL
- Migration expectation:
  - Requires replacement, not in-place update
  - Requires endpoint/config re-validation after cutover

## Risk Legend

- **LOW**: Config abstraction present, minimal coupling, expected smooth migration
- **MEDIUM**: Dynamic runtime dependencies or non-trivial topology need extra validation
- **MEDIUM-HIGH**: Shared resources create multi-service blast radius
- **HIGH**: Hard-coded endpoints or required resource replacement likely to break flows
