# Azure workshop infrastructure

This resource-group-scoped Bicep deployment creates the feedback application's
Storage account and table, Log Analytics workspace, Application Insights
component, Linux App Service plan, and Linux web app.

The web app uses a system-assigned managed identity. A native role assignment
grants that identity only **Storage Table Data Contributor** on the storage
account. Shared-key access is disabled. Storage remains reachable over its
public endpoint so App Service can use it without workshop VNet dependencies;
authorization is still Microsoft Entra ID-only. The web app requires HTTPS and
TLS 1.2, disables FTP/SCM basic publishing credentials, and sends diagnostics
and application telemetry to workspace-based Application Insights. The app's
main site admits only explicitly supplied workshop CIDRs and denies all other
inbound requests by default.

## Pinned Azure Verified Modules

| Resource | Module | Version |
|---|---|---:|
| Storage account and table | `avm/res/storage/storage-account` | `0.33.1` |
| Log Analytics workspace | `avm/res/operational-insights/workspace` | `0.16.1` |
| Application Insights | `avm/res/insights/component` | `0.8.0` |
| App Service plan | `avm/res/web/serverfarm` | `0.7.0` |
| Linux web app | `avm/res/web/site` | `0.24.0` |

The role assignment is composed directly because the storage module cannot
consume the web app principal without creating a circular module dependency.

## Parameters

Copy `main.example.bicepparam` to an environment-specific file that is not
committed with secrets. The example contains no subscription, tenant, or
credential values. Resource names are derived from the target resource group
and `teamIdentifier`, which isolates teams while satisfying Azure global naming
requirements. Supply one to 100 instructor-approved IPv4 or IPv6 network
ranges in `workshopAllowedCidrs`. The reserved `198.51.100.0/24` example is
documentation-only and is not a usable participant network; replace it before
deployment. An empty or omitted allowlist is invalid and never means
unrestricted access.

## Validate

```powershell
az bicep build --file .\infra\main.bicep
az deployment group validate `
  --resource-group <team-resource-group> `
  --parameters .\infra\main.example.bicepparam
az deployment group what-if `
  --name workshop-infra-preview `
  --resource-group <team-resource-group> `
  --parameters .\infra\main.example.bicepparam
```

`validate` and `what-if` require an authenticated Azure CLI session and access
to the assigned team resource group. No subscription-level deployment is
needed. Both commands must use the same reviewed allowlist as the eventual
deployment.

## Deploy

```powershell
az deployment group create `
  --name workshop-infra `
  --resource-group <team-resource-group> `
  --parameters .\infra\main.example.bicepparam
```

The deployment outputs the application name and HTTPS URL, deployment
identifier, monitoring resource names/IDs, and storage account/table details.
The deployment workflow temporarily adds only its current GitHub runner's
public IPv4 `/32` for smoke checks, removes the run-specific rule even if checks
fail, confirms removal, and verifies that an outside request is denied.
Deployment evidence is withheld if cleanup or the denial check fails. This
network boundary is not participant authentication; anyone on an approved
workshop network can use the unauthenticated application.
