# Article 2: Handoff Protocol

## 2.1 Purpose
This article defines how parcels move between roles in the SwarmForge pipeline.

## 2.2 Draft Format
All handoffs use the following JSON format, written to `tmp/handoff.txt` and sent via `swarm_handoff.sh`:

```json
{
  "type": "task|note|merge_up",
  "to": "<role>",
  "priority": "<00-99>",
  "task": "<task_name>",
  "commit": "<git_hash>",
  "message": "<optional_description>",
  "enqueued_at": "<ISO8601_timestamp>"
}
```

- **`type`**: `task` (code work), `note` (coordination), or `merge_up` (QA-approved work).
- **`priority`**: `00` (blocking), `10-49` (normal), `50` (batch mode).
- **`task`**: Stable name for the parcel (e.g., `feat/add-login-button`).
- **`commit`**: Git hash of the work to be reviewed/continued.

## 2.3 Sending Rules
1. **Use `swarm_handoff.sh` only** – Never write directly to `inbox/new/`.
2. **No-Op Rule** – If a commit produces no functional change, do not forward it.
3. **Audit Headers** – Include `enqueued_at` for latency tracking.

## 2.4 Receiving Rules
1. **`ready_for_next.sh`** – Roles must use this script to receive work (checks `in_process/` first).
2. **Batch Mode** – Roles marked as "batch" (e.g., cleaner, hardener) process multiple parcels at once.
3. **Stuck Detection** – If a parcel sits in `inbox/new/` for >10 minutes, the coordinator must chase it.

## 2.5 Merge-Up Protocol
- **QA** sends a `merge_up` handoff to the **specifier** after approval.
- The **specifier** merges the commit into `main` and notifies the coordinator.
