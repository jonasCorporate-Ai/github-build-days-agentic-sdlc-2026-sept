# Proposal

## Why

Workshop users currently cannot tell whether a feedback item is new, being considered, or complete without changing its original request. Issue #1 asks for a small, visible lifecycle that preserves the existing feedback and voting behavior.

## What Changes

- Add a forward-only feedback lifecycle with exactly `new`, `planned`, and `done` states; new feedback starts as `new`.
- Expose status updates through the feedback API, reject unsupported, skipped, reversed, and unknown-item updates without changing stored state, and keep status visible after reload.
- Display each item's status and accessible controls for advancing it, with usable loading, success, empty, and error feedback.
- Preserve existing feedback creation, listing, voting, and persistence behavior. Restrict the deployed board to instructor-approved workshop network ranges before enabling unauthenticated status updates.
- Add focused contract, storage/API, UI, ingress, and deployment-smoke evidence without changing the application feature beyond feedback status.

## Capabilities

### New Capabilities

- `feedback-status`: Define and display feedback status and enforce valid forward-only transitions.

### Modified Capabilities

None. The repository has no canonical capabilities under `openspec/specs/`; the related `feedback-application` requirements are part of another in-progress change and are not modified here.

## Impact

- **Application:** `src/shared/`, `src/server/`, and `src/client/` for the shared status contract, persisted update behavior and API, and board controls.
- **Tests:** focused coverage in `tests/contracts.test.ts`, `tests/storage.test.ts`, `tests/api.test.ts`, and `tests/App.test.tsx`, adjusted as needed after implementation.
- **Documentation:** record network setup and recovery in `infra/README.md` and instructor deployment guidance, alongside the change-local trust-boundary decisions.
- **Infrastructure/workflows:** configure App Service ingress to allow only instructor-provided workshop CIDRs; adapt deployment smoke checks to use a temporary runner-IP exception and remove it even when verification fails. Validate allowed and denied access. No new dependencies or identity changes are expected.
- **Security:** network restrictions protect the entire deployed board, not just status updates. They do not authenticate individual participants; status updates remain unauthenticated within the approved networks.
