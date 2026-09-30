# Design

## Context

See [proposal.md](proposal.md) for motivation and [specs/feedback-status/spec.md](specs/feedback-status/spec.md) for observable requirements. The React client and Express API share TypeScript contracts. Both in-memory and Azure Table adapters implement `FeedbackStorage`; Azure uses one feedback entity per partition and vote updates already use ETags and transactions. The feedback board has no authentication. Root `DESIGN.md` requires inward dependency direction and preserves the storage interface between the API and Azure-specific code.

## Goals / Non-Goals

**Goals:**

- Keep the status lifecycle and validation consistent across the API, storage adapters, and UI.
- Preserve records created before the status property exists without a data migration.
- Make each accepted transition a storage-level state change rather than a client-only presentation update.
- Make the workshop trust boundary enforceable at App Service ingress without changing voting semantics.

**Non-Goals:**

- Add sign-in, roles, authorization, status history, notifications, bulk updates, or custom statuses.
- Change managed-identity permissions, storage access, or participant sign-in.
- Add a new dependency or a table migration.

## Decisions

### Keep status in the shared feedback contract and assign it server-side

Define the exact status values and an update-request schema in the shared contract. New feedback is created with `new` in each storage adapter; callers do not select its initial status. The public `Feedback` shape includes a status. When reading an older Azure row with no status property, map it to `new`, so old records remain readable without backfill.

This keeps status handling type-safe and makes create/list responses consistent. Making status optional throughout the client would spread legacy handling into every consumer; a data migration would add deployment and rollback risk without changing the intended behavior.

### Enforce transitions at the storage boundary

Add a status-transition operation to `FeedbackStorage`, implemented by both adapters, and invoke it from a focused API endpoint. The storage operation accepts only `new` to `planned` or `planned` to `done`; it reports unknown feedback separately from an invalid transition so the API can return not-found and conflict responses. Validate the requested status before accessing storage and return actionable validation errors for unsupported values.

The Azure adapter reads the current entity, validates the edge, and writes with its current ETag. On an ETag conflict it must re-read and re-evaluate the requested transition, returning a conflict if it is no longer valid rather than overwriting a concurrent update. The in-memory adapter applies the same transition checks. This prevents races or client-side calls from skipping or reversing a state. A UI-only status or a client-side-only transition check would not protect stored state or survive refresh.

### Restrict ingress to approved workshop networks

The existing App Service explicitly enables public network access with no caller restrictions, so the previous claim of a trusted-board boundary is not true as deployed. Keep its public endpoint for approved workshop networks, but configure the pinned web-site AVM's App Service main-site IP security restrictions to allow only instructor-supplied workshop CIDRs and deny all other inbound requests by default. Apply the restriction to the entire site rather than just the new status route: the existing create and vote endpoints are unauthenticated too. Require a non-empty allowlist as a deployment input; do not commit actual attendee addresses or permit a missing value to mean unrestricted access. Update the infrastructure README and instructor setup for obtaining/maintaining the ranges and confirming that participants can reach the board. Verify the pinned AVM supports the restriction when implementing; document an exact module gap before any native-resource exception.

The deployment workflow currently performs `/health`, `/ready`, create, and vote checks from a GitHub-hosted runner, which the permanent allowlist would block. During verification, allow only that run's discovered egress address as a temporary /32 ingress rule, remove the rule in a guaranteed cleanup step even on verification failure, and fail the run if cleanup cannot be confirmed. Serialize deployments to avoid one run removing another's rule and use distinct priorities/names so the temporary rule cannot replace the permanent allowlist. Prove that an out-of-range request is denied after removal and preserve smoke-test evidence from the temporary authorized window. Fail before deployment when approved CIDRs are missing; never temporarily allow all IPs.

This is network-based workshop access, not individual authorization. Anyone on an approved network can request status changes. If access must be limited to specific users, a separate authentication change is needed.

### Render status as text and offer only the next action

Show the current status label on each feedback card and provide a clearly named, keyboard-operable action for only the next legal transition. Reuse the board's existing status/notice/error patterns to announce pending, successful, and failed updates. Keep the last confirmed item state on failure. The status endpoint returns the updated feedback, and the client replaces only that item so its vote count and other fields remain intact.

## Risks / Trade-offs

- **Workshop networks may be dynamic or shared with untrusted users** → Instructor verifies the assigned ranges and participants' access before deployment; network restrictions are not user authentication.
- **Runner access-rule cleanup might fail after smoke checks** → Always execute removal on success and failure, confirm the rule is gone, fail deployment evidence on incomplete cleanup, and use the configured infrastructure allowlist to restore the known restricted state.
- **The existing public URL smoke test will fail once ingress is restricted** → Admit only the current runner's egress /32 during checks and verify denial after cleanup. Do not weaken smoke or claim deployment success if cleanup fails.
- **Concurrent Azure updates may race** → Use ETag-conditional writes and re-evaluate after conflicts; cover invalid and concurrent outcomes in focused tests.
- **Legacy records do not contain a status property** → Normalize missing status to `new` on read, avoiding a one-time migration and preserving existing content and votes.
- **Persisted status values could be malformed outside the application** → Normalize only absent legacy values; treat unexpected stored values as an explicit storage/data error rather than silently presenting an invalid lifecycle state.

## Migration Plan

No data migration is required. First collect and validate workshop CIDRs, deploy the restricted ingress and smoke-test adjustments, and confirm allowed participant access and denied outside access before enabling status updates. Existing rows without status are read as `new`, and the first accepted transition writes a status property. Roll back application code without removing the ingress restrictions; older code ignores the additional Azure Table property. Never restore the prior unrestricted ingress as an automatic rollback.

The durable repository boundary in root `DESIGN.md` must reflect workshop-only network ingress once enforced. The pinned AVM composition and deployment workflow change, but Azure identity, role permissions, storage network policy, and credentials do not.
