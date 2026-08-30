# Article 2: Handoff Protocol

## 2.1 Purpose
This article defines how parcels move between roles in the SwarmForge pipeline.

## 2.2 Draft Format
A handoff draft is plain `field: value` header lines — one per line, no
JSON, no body. A role with its own `.worktrees/<role>` checkout writes its
draft to worktree-local `tmp/handoff.txt`; the master-resident roles
(coordinator, specifier) write to `swarmforge/runtime/handoff-draft.txt`
instead — never `.swarmforge/`. A JSON envelope is **rejected** (every
brace/quote line parses as an unknown header). See
**02-handoffs-detailed.md** for the full pre-trim wording and two
worked examples (`git_handoff`, `note`).

**`type`** must be one of `awake`, `git_handoff`, `note`, or `rule_proposal`.
There is no `task` or `merge_up` type — a QA merge-up signal is a `note`
(see 2.5). Example shape: `type: git_handoff` / `to: cleaner` /
`priority: 50` / `task: <stable-name>` / `commit: <10-hex>`.

Field rules: **`priority`** is two digits `00`-`99` (`00`=blocking; receive
mode task/batch is a role property, not priority). **`task`**/**`commit`**
are `git_handoff`-only (`commit` = exactly 10 hex chars, one real commit).
**`message`** is `note`-only (≤80 chars). **`rule_proposal`** carries
`scope`/`body`/`rationale`. Agents write only draft fields — envelope/audit
headers are **reserved** (tool/daemon-stamped; writing one is rejected). The
exhaustive reference is `swarmforge/handoff-protocol.md`; this section
summarizes it and must not diverge. See **02-handoffs-detailed.md**
for the full pre-trim wording.

## 2.3 Sending Rules
Use `swarm_handoff.sh` only (never write `inbox/new/` directly — no
wake-up that way). No-Op Rule: don't forward a commit with no functional
change (narrow meta-churn exemption; see `handoff-protocol.md`). Never
write reserved/audit headers. See **02-handoffs-detailed.md**.

**Self-audit (git_handoff only).** The first valid `swarm_handoff.sh`
invocation for a given draft fingerprint prints `AUDIT_REQUIRED` /
`HANDOFF_NOT_QUEUED` and does **not** queue. Re-read the inbound, diff,
and checks; fix and commit if needed; invoke the helper again with an
identical draft to queue. A changed draft invalidates the prior challenge.
Notes are unchanged (single call).

**Reverse hops.** Pack windows may declare `forward-only` (default),
`back-one`, or `back-all` after the receive mode. On a queued `git_handoff`,
the helper also writes priority-`00` `non-forwarding: true` copies to the
previous role (`back-one`) or all earlier pipeline roles (`back-all`),
never to `coordinator`. Agents draft only the forward `to:`; reverses are
helper-synthesized. The last non-coordinator pack role's forward
`git_handoff` is also stamped `non-forwarding: true` (terminal).

## 2.4 Receiving Rules
Use `ready_for_next.sh` to receive work (checks `in_process/` first). Batch
roles (cleaner, hardener) process multiple parcels at once. A parcel stuck
in `inbox/new/` >10 minutes: the coordinator must chase it. See
**02-handoffs-detailed.md**.

A `non-forwarding: true` inbound is **merge-only**: run the payload merge,
then `done_with_current.sh`. Do **not** send a `git_handoff` for that
inbound — the helper refuses while such an inbound is `in_process`. On a
reverse (handback), the inbound tree is the structure; replay this role's
current task onto that shape.

## 2.5 Merge-Up Protocol
The full sequence (QA broadcast → land on `main` → coordinator bookkeeping)
is stated in `PIPELINE.md` steps 5–6 — not repeated here. Draft-format
mechanics: 2.2/2.3 above. See **02-handoffs-detailed.md**.

QA merge-up **notes** remain the QA→upstream sync path for now (QA windows
stay `forward-only`). Reverse hops on cleaner/architect may coexist; do not
treat reverse copies as a replacement for the QA note broadcast until that
migration is explicit.

## 2.6 Multi-Ticket Batch Forwards Carry Every Ticket ID
- A `git_handoff` names ONE ticket. When a batch role's committed work
  satisfies MORE THAN ONE ticket, forward EACH as its own `git_handoff`
  under its own stable task name — never collapse (same per-item discipline
  as the no-op rule, BL-075). QA approving a multi-ticket commit: the
  coordinator note must name EVERY satisfied ID and move ALL to
  `backlog/done/` — an ID that never reaches the note stays active forever.
  See **02-handoffs-detailed.md** and **workflow-detailed.prompt**
  for the full pre-trim wording and the BL-417/BL-420 incident.
