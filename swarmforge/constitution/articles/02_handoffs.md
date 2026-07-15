# Article 2: Handoff Protocol

## 2.1 Purpose
This article defines how parcels move between roles in the SwarmForge pipeline.

## 2.2 Draft Format
A handoff draft is plain `field: value` header lines — one per line, no JSON,
no body (`swarm_handoff.sh` generates the body) — written to
`swarmforge/runtime/handoff-draft.txt` and sent via `swarm_handoff.sh` (not
repo-root `tmp/` or `.swarmforge/`, which are gitignored). A JSON envelope is
**rejected**: every brace/quote line parses as an unknown header.

**`type`** must be one of `awake`, `git_handoff`, `note`, or `rule_proposal`.
There is no `task` or `merge_up` type — a QA merge-up signal is a `note`
(see 2.5).

Example `git_handoff` (the common pipeline forward):

```text
type: git_handoff
to: cleaner
priority: 50
task: <short-stable-task-name>
commit: <10-char-commit-abbrev>
```

Example `note`:

```text
type: note
to: coordinator
priority: 00
message: <single line, 80 chars max>
```

Field rules:
- **`priority`**: exactly two digits `00`–`99`; lower is processed first
  (`00` = blocking). Receive mode (task vs batch) is a role property, not a
  priority value.
- **`task`** / **`commit`**: `git_handoff` only. `commit` must be exactly 10
  hexadecimal characters and resolve to one real commit; `message` is not valid
  on a `git_handoff`.
- **`message`**: `note` only — a single line, 80 characters max.
- **`rule_proposal`**: carries `scope`, `body`, and `rationale`.
- Agents write only draft fields. Envelope/audit headers (`id`, `from`, `role`,
  `recipient`, `created_at`, `enqueued_at`, `dequeued_at`, `completed_at`) are
  **reserved** — the tool and daemon stamp them; writing one gets the draft
  rejected.

The exhaustive field and validation reference is `swarmforge/handoff-protocol.md`
(a.k.a. HANDOFF-PROTOCOL.md). This section is a summary of it and must not
diverge from the tool's actual grammar.

## 2.3 Sending Rules
1. **Use `swarm_handoff.sh` only** – Never write directly to `inbox/new/`; that
   path sends no wake-up.
2. **No-Op Rule** – If a commit produces no functional change, do not forward it
   (narrow meta-churn exemption only; see `handoff-protocol.md`).
3. **Never write reserved/audit headers** – `enqueued_at` and every other
   envelope header are stamped by the tool and daemon for latency/audit; an
   agent draft that includes one is rejected.

## 2.4 Receiving Rules
1. **`ready_for_next.sh`** – Roles must use this script to receive work (checks `in_process/` first).
2. **Batch Mode** – Roles marked as "batch" (e.g., cleaner, hardener) process multiple parcels at once.
3. **Stuck Detection** – If a parcel sits in `inbox/new/` for >10 minutes, the coordinator must chase it.

## 2.5 Merge-Up Protocol
- **QA** broadcasts a `note` to pipeline worktree roles (`coder`, `cleaner`,
  `architect`, `hardender`, `documenter`) instructing each to merge its branch up
  to QA's approved commit.
- **QA** lands the approved commit on `main` and pushes origin (QA is the
  integration point), then sends approval to the **coordinator** (approved commit
  + task id).
- The **coordinator** does backlog bookkeeping only: moves the ticket from
  `backlog/active/` to `backlog/done/` and promotes the next paused item if a
  slot is open. It runs no git merge or push (BL-247).
- The **specifier** does not perform integration merges — it specifies only.
