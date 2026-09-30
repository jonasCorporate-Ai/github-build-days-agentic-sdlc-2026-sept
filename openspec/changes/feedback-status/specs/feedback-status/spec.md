# Spec Delta

## Purpose

This capability lets workshop participants track feedback through a small, visible lifecycle while preserving the original feedback and its votes.

## ADDED Requirements

### Requirement: Feedback status lifecycle

The application SHALL expose exactly three feedback statuses: `new`, `planned`, and `done`. Newly created feedback SHALL have status `new`; existing feedback without a stored status SHALL be presented as `new`. Status SHALL be included in feedback returned by create and list operations and SHALL persist across reloads and application restarts.

#### Scenario: New feedback receives its initial status

- **WHEN** a participant creates valid feedback
- **THEN** the returned and listed feedback has status `new`

#### Scenario: Existing feedback without a stored status remains visible

- **WHEN** the board reads feedback created before status was introduced
- **THEN** the feedback is returned and displayed with status `new` without losing its content or votes

#### Scenario: Status remains after reload or restart

- **WHEN** a valid status transition is completed and the board is reloaded or the application restarts
- **THEN** the feedback retains its updated status

### Requirement: Forward-only status transitions

The application SHALL allow only the adjacent transitions `new` to `planned` and `planned` to `done`. It SHALL reject unsupported statuses and every other transition without changing stored feedback.

#### Scenario: Participant advances new feedback

- **WHEN** a participant changes feedback from `new` to `planned`
- **THEN** the application persists and returns status `planned`

#### Scenario: Participant completes planned feedback

- **WHEN** a participant changes feedback from `planned` to `done`
- **THEN** the application persists and returns status `done`

#### Scenario: Participant skips or reverses a transition

- **WHEN** a participant requests a transition other than the two adjacent forward transitions
- **THEN** the application rejects the request with an actionable conflict response and leaves the stored status unchanged

#### Scenario: Participant submits an unsupported status

- **WHEN** a participant requests a status outside `new`, `planned`, and `done`
- **THEN** the application rejects the request with an actionable validation response and leaves stored feedback unchanged

#### Scenario: Participant updates an unknown feedback item

- **WHEN** a participant requests a status update for an unknown feedback identifier
- **THEN** the application returns a not-found response without creating feedback or changing any stored data

### Requirement: Accessible status controls preserve voting

The board SHALL display each feedback item's current status as text and provide accessible controls only for its next valid status transition. Status update progress, success, and failure SHALL be communicated accessibly. A failed update SHALL leave the displayed status unchanged and allow the participant to retry. Status updates SHALL NOT change vote counts or existing voting behavior.

#### Scenario: Participant advances status from the board

- **WHEN** a participant activates the control for the next status
- **THEN** the board shows the persisted status, announces success, and does not change the feedback's vote count

#### Scenario: Status update is pending

- **WHEN** a status update is in progress
- **THEN** its control communicates progress and cannot submit a duplicate update

#### Scenario: Status update fails

- **WHEN** the status update is rejected or unavailable
- **THEN** the board announces an actionable error, retains the last confirmed status, and leaves the control available for retry

#### Scenario: Feedback board has no items or cannot load

- **WHEN** the board is empty or feedback cannot be loaded
- **THEN** the existing accessible empty or retryable loading-error state remains available

#### Scenario: Participant votes after a status update

- **WHEN** a participant votes for feedback whose status has changed
- **THEN** the existing voting rules apply and the status remains unchanged

### Requirement: Workshop-only deployed ingress

The deployed feedback board SHALL admit inbound requests only from explicitly supplied workshop network ranges. Requests from other networks SHALL be denied before reaching the application, including status, feedback, voting, and health routes. Deployment SHALL NOT proceed without a non-empty, explicitly supplied workshop allowlist; no production authentication is implied by network access.

#### Scenario: Workshop participant accesses the board

- **WHEN** a participant accesses the deployed board from an approved workshop network
- **THEN** the board and its feedback API are reachable

#### Scenario: Visitor outside the workshop accesses the board

- **WHEN** a visitor accesses the deployed board or status API from outside the approved network ranges
- **THEN** ingress denies the request without changing feedback or votes

#### Scenario: Workshop network ranges are absent

- **WHEN** a deployment has no explicitly supplied workshop allowlist
- **THEN** deployment stops without opening the board to unrestricted traffic

#### Scenario: Deployment smoke verification completes or fails

- **WHEN** the deployment runner is temporarily admitted for live health, readiness, feedback, and voting checks
- **THEN** its temporary access is removed after verification, including when verification fails, and the permanent workshop allowlist remains in effect
