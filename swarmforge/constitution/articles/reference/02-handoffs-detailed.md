# Article 2 (Handoff Protocol) — detailed reference (BL-858 split)

On-demand elaboration for `02_handoffs.md`. Not inlined at boot.

## 2.2 Draft Format — pre-second-trim wording (BL-858 further split)

`02_handoffs.md`'s own text, verbatim, before BL-858's second pass:

> A handoff draft is plain `field: value` header lines — one per line, no JSON,
> no body (`swarm_handoff.sh` generates the body) — written to a per-role draft
> file and sent via `swarm_handoff.sh`. Where that draft file lives depends on the
> role's worktree: a role with its own `.worktrees/<role>` checkout (coder,
> cleaner, architect, hardender, documenter, QA) writes it to its worktree-local
> `tmp/handoff.txt` (gitignored per worktree, the right home for a transient
> draft); the master-resident roles that share the master checkout (coordinator,
> specifier) write it to `swarmforge/runtime/handoff-draft.txt` instead. Do not put
> the draft in `.swarmforge/` (gitignored runtime state). A JSON envelope is
> **rejected**: every brace/quote line parses as an unknown header.
>
> Example `git_handoff` (the common pipeline forward):
>
> ```text
> type: git_handoff
> to: cleaner
> priority: 50
> task: <short-stable-task-name>
> commit: <10-char-commit-abbrev>
> ```
>
> Example `note`:
>
> ```text
> type: note
> to: coordinator
> priority: 00
> message: <single line, 80 chars max>
> ```

## Field rules, 2.3, 2.4, 2.6 — pre-second-trim wording (BL-858 further split)

`02_handoffs.md`'s own text, verbatim, before BL-858's second pass:

> The exhaustive field and validation reference is `swarmforge/handoff-protocol.md`
> (a.k.a. HANDOFF-PROTOCOL.md). This section is a summary of it and must not
> diverge from the tool's actual grammar.

> Field rules:
> - **`priority`**: exactly two digits `00`–`99`; lower is processed first
>   (`00` = blocking). Receive mode (task vs batch) is a role property, not a
>   priority value.
> - **`task`** / **`commit`**: `git_handoff` only. `commit` must be exactly 10
>   hexadecimal characters and resolve to one real commit; `message` is not valid
>   on a `git_handoff`.
> - **`message`**: `note` only — a single line, 80 characters max.
> - **`rule_proposal`**: carries `scope`, `body`, and `rationale`.
> - Agents write only draft fields. Envelope/audit headers (`id`, `from`, `role`,
>   `recipient`, `created_at`, `enqueued_at`, `dequeued_at`, `completed_at`) are
>   **reserved** — the tool and daemon stamp them; writing one gets the draft
>   rejected.
>
> ## 2.3 Sending Rules
> 1. **Use `swarm_handoff.sh` only** – Never write directly to `inbox/new/`; that
>    path sends no wake-up.
> 2. **No-Op Rule** – If a commit produces no functional change, do not forward it
>    (narrow meta-churn exemption only; see `handoff-protocol.md`).
> 3. **Never write reserved/audit headers** – `enqueued_at` and every other
>    envelope header are stamped by the tool and daemon for latency/audit; an
>    agent draft that includes one is rejected.
>
> ## 2.4 Receiving Rules
> 1. **`ready_for_next.sh`** – Roles must use this script to receive work (checks `in_process/` first).
> 2. **Batch Mode** – Roles marked as "batch" (e.g., cleaner, hardener) process multiple parcels at once.
> 3. **Stuck Detection** – If a parcel sits in `inbox/new/` for >10 minutes, the coordinator must chase it.
>
> ## 2.6 Multi-Ticket Batch Forwards Carry Every Ticket ID
> - A `git_handoff` names ONE ticket in its `task` field. When a batch role
>   (cleaner, hardener) processes several parcels together and its committed
>   work satisfies MORE THAN ONE ticket, it must forward EACH satisfied ticket
>   as its own `git_handoff` under that ticket's own stable task name — never
>   collapse several tickets under a single task name (same per-item discipline
>   as the no-op rule, BL-075).
> - Correspondingly, when QA approves a commit that satisfied more than one
>   ticket, its coordinator bookkeeping note must name EVERY satisfied ticket
>   ID and move ALL of them to `backlog/done/` — an ID that never reaches the
>   coordinator note stays active forever.

## 2.5 Merge-Up Protocol — full text before this parcel pointed at PIPELINE.md

`02_handoffs.md`'s own text, verbatim, before BL-858 compressed it to a
pointer (the same sequence is also stated in `PIPELINE.md` steps 5-6, same
boot prefix — this snapshot exists so the exact prior wording, including the
phrasing absent from PIPELINE.md, stays retrievable):

> - **QA** broadcasts a `note` to pipeline worktree roles (`coder`, `cleaner`,
>   `architect`, `hardender`, `documenter`) instructing each to merge its branch up
>   to QA's approved commit.
> - **QA** lands the approved commit on `main` and pushes origin (QA is the
>   integration point), then sends approval to the **coordinator** (approved commit
>   + task id).
> - The **coordinator** does backlog bookkeeping only: moves the ticket from
>   `backlog/active/` to `backlog/done/` and promotes the next paused item if a
>   slot is open. It runs no git merge or push (BL-247).
> - The **specifier** does not perform integration merges — it specifies only.
