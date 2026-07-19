# BL-538 – Console Paused-Ticket Pager

## Overview

BL-538 introduces a **console-based pager** for tickets that are in a *paused* state. The goal is to give operators and roles a fast, low-friction way to see which tickets are paused, identify which ones need attention, and trigger a “page” or reminder action from the console.

This spec assumes paused tickets are tracked in the backlog and carry enough metadata (ID, title, owner/role, pause reason, timestamps) to drive the pager.

## Scope

In scope:

- A console UI (CLI program) that:
  - Lists paused tickets.
  - Highlights paused tickets that require paging.
  - Allows an operator to trigger a page/reminder per ticket.
- Behavior and acceptance criteria for:
  - Discovering paused tickets.
  - Determining when a ticket should be paged.
  - Paging workflow, including error handling and idempotency.
  - Read-only safe behavior when paging endpoints are unavailable.

Out of scope:

- Changes to how tickets enter or leave the paused state.
- UI beyond the console (no web UI in this spec).
- Changes to SLA or backlog depth rules; the pager only observes them.

## Terminology

- **Paused ticket**: A ticket in any backlog folder or state designated as “paused” by the backlog pipeline (e.g., `backlog/paused`, a `status: paused` field, or equivalent).
- **Pager console**: The CLI tool defined in this spec.
- **Page**: A reminder or nudge action triggered from the console, sent to the responsible role or owner (for example via log, stdout, or integration).
- **Owner**: The role or human responsible for the ticket, as indicated in the backlog metadata.

## Functional Requirements

### 1. Discovering Paused Tickets

1. The console must read the backlog configuration and ticket files to determine which tickets are currently considered *paused*.
2. Paused tickets must be discoverable from:
   - A dedicated `backlog/paused` folder, **or**
   - Ticket fields indicating a paused state (for example `status: paused`, `status: on_hold`, or similar).
3. Each paused ticket must expose at least:
   - Ticket ID (e.g. `BL-538`).
   - Short title (e.g. `console paused-ticket pager`).
   - Owner or assigned role (if known).
   - Pause reason or status.
   - Time when the ticket entered the paused state.
4. Tickets not in a paused state must **not** be listed in the pager.

### 2. Console Listing of Paused Tickets

1. When the console is invoked with no additional arguments, it must render a table-like view of paused tickets to stdout.
2. The listing must include, per ticket:
   - Ticket ID.
   - Title.
   - Owner/role.
   - Pause reason/status.
   - Age in paused state (e.g. `3h 12m`, `2d 4h`).
3. The listing must be sorted in a deterministic order, one of:
   - Oldest paused first (default), **or**
   - Highest priority first, with oldest as secondary sort.
4. The console must support an option to filter tickets by:
   - Owner/role (e.g. `--owner specifier`).
   - Age threshold (e.g. `--older-than 2h`).
   - Specific ticket ID (e.g. `--ticket BL-538`).
5. If there are **no** paused tickets matching the filters:
   - The console must exit with a success (0) status.
   - It must print a clear message such as `No paused tickets found` to stdout.
   - It must not attempt any paging.

### 3. Highlighting Tickets That Need Paging

1. The console must determine whether a paused ticket should be paged based on criteria such as:
   - Age threshold exceeded (for example, paused longer than a configured maximum duration).
   - Presence of a “needs-page” flag or equivalent metadata.
   - Priority of the ticket (e.g. higher priority paused tickets are more urgent).
2. Tickets that meet the paging criteria must be visually distinguished in the listing, e.g.:
   - A marker column such as `PAGE?` with `yes`/`no`.
   - Color or emphasis (where the terminal supports it).
3. Tickets that do **not** meet paging criteria must still appear in the listing, but must not be marked for paging.

### 4. Paging Workflow

1. The console must support interactive paging for a selected ticket:
   - The operator chooses a ticket (e.g. by ID or by index in the list).
   - The console displays a confirmation prompt summarizing:
     - Ticket ID, title, owner.
     - Reason for paging (e.g. “paused longer than 24h”).
   - The operator confirms or cancels.
2. On confirmation, the console must perform a “page” action:
   - At minimum, logging a structured reminder containing:
     - Ticket ID.
     - Owner/role.
     - Timestamp.
     - Reason for paging.
   - Optionally, sending the reminder to a downstream channel (e.g. stdout, a notification file, or a preconfigured notifier).
3. If the paging action succeeds:
   - The console must show a success message for that ticket (e.g. `Paged BL-538 to specifier`).
   - It may optionally tag the ticket as “paged” in a sidecar file, avoiding repeated pages for the same paused state.
4. If the paging action fails (e.g. downstream notifier unavailable):
   - The console must:
     - Print a clear error message, including the ticket ID and the cause.
     - Exit with a non-zero status, **without** losing the ticket’s state.
   - The console must not mark the ticket as successfully paged if the downstream action did not succeed.

### 5. Idempotency and Repeated Runs

1. Paging must be idempotent with respect to a given paused state:
   - If a ticket was already successfully paged for its current paused state, the console must not page it again unless explicitly forced (e.g. `--force`).
2. The console must maintain a simple record of which paused tickets have been paged:
   - For example, a small sidecar file keyed by ticket ID and a paused-state timestamp.
3. On subsequent runs:
   - Tickets that are still paused but already paged must appear in the listing, with an indication such as `paged: yes`, but must not be auto-paged.
   - Tickets newly entering the paused state or crossing thresholds should be eligible for paging.

### 6. Ticket State Transitions

1. The console must treat tickets as paused only while they are in a designated paused state:
   - When the backlog changes a ticket’s status from paused to active/resumed/completed, that ticket must no longer appear in the pager.
2. If the console is invoked while a ticket is transitioning out of paused state:
   - The console must not page it if the metadata already indicates it is no longer paused.
3. Tickets that change from one paused state to another (e.g. `on_hold` to `awaiting client`) must be treated as still paused:
   - The console must display the new pause reason.
   - Paging idempotency must consider the new state as distinct if the pause timestamp changes.

### 7. Error Handling and Robustness

1. If the console encounters a malformed ticket record (missing ID, missing title, or unreadable pause state):
   - It must skip paging that ticket.
   - It must print a diagnostic line identifying the ticket path and the issue.
   - It must continue processing other tickets.
2. If backlog directories or configuration files are missing:
   - The console must report the missing resources.
   - It must exit with a non-zero status.
3. The console must not modify backlog ticket files directly:
   - All changes related to paging must be in separate sidecar state files or logs.
4. The console must be safe to run repeatedly:
   - It must not produce duplicate pager entries for the same ticket and state in its output.
   - It must not corrupt any backlog data.

## Non-Functional Requirements

1. The console must run as a non-interactive command when invoked with only listing options:
   - For example, `paused-ticket-pager --list` prints the table and exits without waiting for input.
2. The console must support interactive mode for paging:
   - For example, `paused-ticket-pager --page BL-538`.
3. The console must be usable from typical terminals:
   - Output must degrade gracefully where colors or advanced features are not available.
4. The console’s behavior must be deterministic given the same backlog state and configuration.

## Example Scenarios

### Scenario 1 – List All Paused Tickets

- Given:
  - Ticket `BL-538` in a paused state for `console paused-ticket pager`.
  - Ticket `BL-528` also paused.
- When:
  - The operator runs `paused-ticket-pager`.
- Then:
  - The console lists both tickets with their IDs, titles, owners, pause reasons, and paused age.
  - Tickets are sorted in a deterministic order (e.g. oldest paused first).
  - No paging happens automatically.

### Scenario 2 – Page a Long-Paused Ticket

- Given:
  - `BL-538` has been paused longer than the configured threshold (e.g. 24 hours).
  - `BL-538` is marked as eligible for paging.
- When:
  - The operator runs `paused-ticket-pager --page BL-538`.
- Then:
  - The console shows a confirmation prompt summarizing BL-538.
  - On confirmation, a page/reminder is recorded (and optionally sent downstream).
  - BL-538 is marked as “paged” for its current paused state.
  - A subsequent run without `--force` does not page BL-538 again while it remains in the same paused state.

### Scenario 3 – No Paused Tickets

- Given:
  - All tickets are active or completed; none are in paused status.
- When:
  - The operator runs `paused-ticket-pager`.
- Then:
  - The console prints `No paused tickets found`.
  - It exits with status 0.
  - No errors or pages are emitted.

### Scenario 4 – Malformed Ticket Record

- Given:
  - A paused ticket file in the backlog is missing its ID or has unreadable metadata.
- When:
  - The operator runs `paused-ticket-pager`.
- Then:
  - The console prints a diagnostic line naming the problematic file and describing the issue.
  - The console skips paging that ticket.
  - Other valid paused tickets are still listed and handled normally.

