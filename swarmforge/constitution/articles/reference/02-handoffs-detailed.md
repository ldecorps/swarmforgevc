# Article 2 (Handoff Protocol) — detailed reference (BL-858 split)

On-demand elaboration for `02_handoffs.md`. Not inlined at boot.

## `02_handoffs.md` — pre-BL-858 full text, in the two runs git's diff sees (BL-858 split)

`02_handoffs.md`'s own text, verbatim, exactly as split by the one context
line BL-858's diff leaves intact in this file (the
"**`type`** must be one of..." sentence) — consolidated here as two blocks
because BL-858 landed as a single squashed commit, so the several separate
edits that produced this file's final form no longer matter to git's own
diff, only these two runs do.

### Run 1 — 2.2's opening paragraph

A handoff draft is plain `field: value` header lines — one per line, no JSON,
no body (`swarm_handoff.sh` generates the body) — written to a per-role draft
file and sent via `swarm_handoff.sh`. Where that draft file lives depends on the
role's worktree: a role with its own `.worktrees/<role>` checkout (coder,
cleaner, architect, hardender, documenter, QA) writes it to its worktree-local
`tmp/handoff.txt` (gitignored per worktree, the right home for a transient
draft); the master-resident roles that share the master checkout (coordinator,
specifier) write it to `swarmforge/runtime/handoff-draft.txt` instead. Do not put
the draft in `.swarmforge/` (gitignored runtime state). A JSON envelope is
**rejected**: every brace/quote line parses as an unknown header.

### Run 2 — the rest of 2.2, and all of 2.3-2.6

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

## 2.6 Multi-Ticket Batch Forwards Carry Every Ticket ID
- A `git_handoff` names ONE ticket in its `task` field. When a batch role
  (cleaner, hardener) processes several parcels together and its committed work
  satisfies MORE THAN ONE ticket, it must forward EACH satisfied ticket as its
  own `git_handoff` under that ticket's own stable task name — never collapse
  several tickets under a single task name. This is the same per-item forward
  discipline batch roles already apply to the no-op rule (BL-075): every parcel
  in the batch gets its own forward decision AND its own forwarded handoff, so
  each ticket's identity travels the chain end to end.
- Correspondingly, when QA approves a commit that satisfied more than one ticket,
  its coordinator bookkeeping handoff/`note` must name EVERY satisfied ticket ID,
  and the coordinator must move ALL of them to `backlog/done/` — not only the one
  task name QA happened to be forwarded under. A ticket whose work merged but
  whose ID never reached the coordinator note stays in `backlog/active/` forever.
- See **workflow-detailed.prompt** for the BL-417/BL-420 collapsed-batch
  incident.
