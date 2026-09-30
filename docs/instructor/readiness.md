# Workshop readiness

Run the full matrix at least one week before the event and again within 24
hours. Use a prepared team repository, not the template. A green local tool
check alone is not event readiness.

## Participant and instructor preflight

The PowerShell script is canonical. Bash emits the same result schema:

```powershell
.\scripts\verify-env.ps1 `
  -Repository "contoso-workshop/workshop-team01" `
  -ExpectedRevision "<approved-template-commit>" `
  -AzureSubscriptionId "<subscription-id>" `
  -AzureResourceGroup "workshop-team01-rg" `
  -JsonOutput ".\preflight-team01.json"
```

```bash
./scripts/verify-env.sh \
  --repository contoso-workshop/workshop-team01 \
  --expected-revision '<approved-template-commit>' \
  --azure-subscription-id '<subscription-id>' \
  --azure-resource-group workshop-team01-rg \
  --json-output ./preflight-team01.json
```

The scripts verify:

- Git, Node.js 20.19+, npm, GitHub CLI, Azure CLI, OpenSpec, and Copilot CLI;
- GitHub and Azure CLI authentication;
- the exact repository and approved template revision;
- Issues, Actions, `workshop-validation` and `workshop` environments;
- required non-secret Actions variables in each exact environment;
- access to the assigned subscription and resource group; and
- a successful `infra-validate.yml` run for the current revision, proving the
  observable OIDC login, Bicep validation, and Azure `what-if` path.

Results are `PASS`, `FAIL`, `ADVISORY`, or `MANUAL`. A required failure exits
non-zero. `NOT_YET_RUN` cloud validation is red by default; instructors may use
`-RequireCloudValidation:$false` or
`--allow-pending-cloud-validation` only during early preparation. It remains
an advisory, never a pass.

Copilot App is always `MANUAL`: shell detection cannot prove installation,
sign-in, repository access, or current availability. Open the app, sign in,
open the team repository, and record that evidence separately.

The JSON output contains only check names and observed configuration; it does
not print tokens or variable values. Do not commit event-specific output.

## Workshop network ingress

Before deployment, obtain the instructor-approved participant and instructor
network CIDRs from the venue/network owner. Configure the protected `workshop`
environment variable `WORKSHOP_ALLOWED_CIDRS` as a comma-separated list of
strict IPv4 or IPv6 network CIDRs; do not put attendee ranges in the repository,
issue, or deployment artifacts. The deployment workflow rejects an empty,
malformed, or oversized list before deploying infrastructure. The Bicep
example's `198.51.100.0/24` is reserved documentation space and must never be
used as an event network.

Set the value as a non-secret variable on the protected `workshop` environment
for each team repository. For example, after loading only the approved
instructor-provided value into the current PowerShell process:

```powershell
gh variable set WORKSHOP_ALLOWED_CIDRS `
  --repo "$env:GH_ORG/$env:TEAM_REPO" `
  --env workshop `
  --body $env:WORKSHOP_ALLOWED_CIDRS
```

From an approved network, verify the board and API are reachable. From a
separate network outside the allowlist, verify that both the health endpoint
and feedback API return HTTP `403`:

```powershell
curl.exe --fail --silent --show-error https://<app-name>.azurewebsites.net/health
curl.exe --silent --output NUL --write-out "%{http_code}" `
  https://<app-name>.azurewebsites.net/health
curl.exe --silent --output NUL --write-out "%{http_code}" `
  https://<app-name>.azurewebsites.net/api/feedback
```

The health check from an approved network must succeed; both requests run from
outside the approved networks must print `403`.
Record the result and test date in the instructor readiness record without
recording personal or attendee addresses in source control. Network allowlisting
is not authentication: anyone on an approved network can use the application.

The deployment workflow admits only that run's GitHub runner IPv4 `/32` while
it checks health, readiness, feedback creation, and voting. It removes the
run-specific rule even when verification fails, confirms the rule is absent,
and checks that the runner is denied afterward. Deployment evidence is not
published if cleanup or outsider denial cannot be confirmed.

If a deployment run reports cleanup failure, inspect only the rule for that
run and remove that exact temporary rule; do not remove `workshop-*` allowlist
rules:

```powershell
$resourceGroup = "<assigned-team-resource-group>"
$appName = "<deployed-app-name>"
$runId = "<failed-github-run-id>"
$ruleName = "github-actions-$runId"
az webapp config access-restriction show `
  --resource-group $resourceGroup `
  --name $appName `
  --output table
az webapp config access-restriction remove `
  --resource-group $resourceGroup `
  --name $appName `
  --rule-name $ruleName
$remaining = az webapp config access-restriction show `
  --resource-group $resourceGroup `
  --name $appName `
  --query "ipSecurityRestrictions[?name=='$ruleName'] | length(@)" `
  --output tsv
if ($remaining -ne "0") { throw "Temporary runner rule remains: $ruleName" }
```

After recovery, repeat the allowed-network and outside-network checks before
accepting deployment evidence.

## Readiness matrix

| Area | Verification | Evidence |
|---|---|---|
| Template | Expected revision and documentation links | Commit SHA |
| Team repo | One repository per table of two or three | Repository URL and preparation report |
| OpenSpec | `openspec validate --all` | Command output |
| Application | Install, focused tests, build, local smoke | Command output |
| Rules | Direct push blocked and review required | Test PR |
| CI | Implemented checks execute real commands | Run URL |
| Security | CodeQL/dependency review or recorded fallback | Run/setting URL |
| OIDC | Numeric owner/repository claims and exact environment; no secret | Preparation report and sign-in evidence |
| Infrastructure | Bicep validation and `what-if`; explicit ingress CIDRs | Successful `infra-validate.yml` run and reviewed network source |
| Deployment | Protected deployment completes; temporary runner rule is removed | Deployment URL and cleanup-confirmed artifact |
| Runtime | Allowed network reaches the board; outside network receives HTTP 403; health, readiness, feedback, and voting pass | Job summary plus instructor ingress check |
| Copilot App | Manual sign-in and repository-open check | Instructor roster |
| App sessions | Chat plus isolated local/worktree session creation | Instructor roster and test sessions |
| App modes | Interactive, Plan, and Autopilot available | Test session evidence |
| Fleet | Parallel task command available and completes bounded test work | Test session evidence |
| Cloud agent | Issue assignment, revision, and PR creation work | Test issue/PR |
| GH-AW | Source/lock valid and safe output produced | Run URL |
| Recovery | Every published checkpoint resolves | Branch list |
| Cleanup | Owner, date, and commands reviewed | Runbook sign-off |

## Go/no-go

Do not advertise a preferred path when:

- any preflight `FAIL` remains;
- Azure quota or App Service capacity is unverified;
- immutable OIDC claims or a successful team-repository login/`what-if` cannot
  be proven;
- required checks cannot run under organization policy;
- Copilot App, cloud-agent, or GH-AW access is assumed rather than tested;
- the App cannot create isolated sessions or use Plan, Fleet, and Autopilot for
  the tested repository;
- recovery checkpoints are missing; or
- cleanup ownership is undefined.

Record unsupported licensed controls and fallbacks accurately. A manual or
fallback result is not equivalent to platform enforcement.

## Optional capstone readiness

Rehearse the optional capstone separately from the four-hour agenda. Confirm:

- the `capstone/` boundary and one selected brief are understandable to a fresh
  App session;
- Plan mode produces a non-overlapping issue graph;
- Fleet can run two independent capstone tasks;
- Autopilot can complete one bounded capstone goal without touching the
  feedback application;
- capstone-scoped CI, AVM/OIDC deployment, bug-fix, and GH-AW paths produce
  durable evidence; and
- the full path fits the advertised 90-120 minute extension or has a clearly
  labeled partial-completion outcome.
