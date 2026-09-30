# Cleanup runbook

## Outcome

Remove temporary Azure resources, identities, repository access, and event
configuration after retaining the evidence required by the workshop owner.

## Before cleanup

- Confirm the retention date for repositories, Actions logs, deployment
  records, and participant evidence.
- Export only approved non-sensitive evidence.
- Confirm no team is still completing the workshop.
- Review resource-group tags and the team roster.

## Azure cleanup

Before deleting a retained team app, inspect its App Service access restrictions
for a stale `github-actions-<run-id>` rule left by a failed deployment. Remove
only the run-specific temporary rule and confirm that no matching rule remains;
preserve all `workshop-*` instructor allowlist rules while the app is in use.
The recovery commands are in [readiness.md](readiness.md#workshop-network-ingress).

List target groups before deletion:

```powershell
az group list `
  --tag "workshop=$env:WORKSHOP_PREFIX" `
  --query "[].{name:name,location:location}" `
  --output table
```

Delete only reviewed workshop resource groups:

```powershell
az group delete `
  --name "$($env:WORKSHOP_PREFIX)-team01-rg" `
  --yes `
  --no-wait
```

Remove the corresponding federated credentials, service principals, and
applications after deployments are no longer required. Use recorded object
identifiers; do not search and delete by a broad name prefix without review.

## GitHub cleanup

According to the retention decision:

- remove temporary participant access;
- disable or remove event-only environment reviewers and variables;
- revoke event-only GitHub App or model access;
- archive or delete disposable test repositories;
- retain team repositories when evidence or participant handoff requires them.

Repository deletion is irreversible and must be separately approved.

## Verification

```powershell
az group list --tag "workshop=$env:WORKSHOP_PREFIX" --output table
gh repo list $env:GH_ORG --limit 200
```

Review Microsoft Entra applications and service principals through the approved
tenant process. Confirm no workload identity remains trusted by a deleted or
transferred repository.

## Completion record

Record:

- cleanup operator and date;
- resource groups removed or intentionally retained;
- identities and federated credentials removed;
- repositories retained, archived, or deleted;
- outstanding cost or access follow-up.
