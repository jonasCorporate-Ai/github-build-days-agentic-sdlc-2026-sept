# Tasks

## 1. Shared Contract and Persistence

- [x] 1.1 Define the three-value feedback status contract and status-update request validation; verify the new contract and unsupported values in `tests/contracts.test.ts`.
- [x] 1.2 Initialize new records as `new`, read legacy records without a status as `new`, and implement atomic adjacent forward transitions in both storage adapters; verify valid, invalid, missing-item, concurrency, and unchanged-vote behavior with `npm test -- tests/storage.test.ts`.

## 2. Status API

- [x] 2.1 Add the status-update endpoint and actionable validation, conflict, and not-found error mapping without changing existing create, list, or vote behavior; verify valid transitions and rejected requests with `npm test -- tests/api.test.ts`.

## 3. Accessible Board Controls

- [x] 3.1 Add status display, next-transition actions, accessible pending/success/error feedback, and client API handling; verify initial status, transitions, failure/retry, empty/loading states, and unchanged voting with `npm test -- tests/App.test.tsx`.

## 4. Workshop Ingress and Deployment

- [x] 4.1 Configure the pinned AVM web site in `infra/main.bicep` to deny non-allowlisted inbound requests and require explicitly supplied workshop CIDRs; update `infra/main.example.bicepparam` and `infra/README.md` without committing real attendee ranges. Verify with `az bicep build --file .\infra\main.bicep` and, when an assigned resource group is available, Azure deployment validation and `what-if`.
- [x] 4.2 Update `.github/workflows/deploy.yml` to reject missing CIDRs before deployment, grant only the current runner's /32 temporarily for live smoke checks, remove and confirm removal even if verification fails, and withhold evidence on cleanup failure; add focused workflow-contract tests in `tests/deployment-evidence.test.ts` and verify with `npm test -- tests/deployment-evidence.test.ts`.
- [x] 4.3 Document instructor network setup, participant access, denied outsider checks, and cleanup recovery in the relevant `docs/instructor/` guidance and update durable ingress boundaries in `DESIGN.md`; verify the documented procedures against the restricted deployment configuration.

## 5. Integrated Verification

- [x] 5.1 Run `npm run check` and `openspec validate --all`; verify allowed workshop access and denied outsider access plus successful runner-rule cleanup against a deployed team app when access is available. Report any Azure validation or live evidence not run rather than implying it passed.
