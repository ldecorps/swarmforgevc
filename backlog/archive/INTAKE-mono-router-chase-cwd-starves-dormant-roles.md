# Raw intake — Mono-router chase starves the swarm: handoffd cwd breaks dormant-role wake remap / rotate

Status: new intake, not minted. Capture only (human via Cursor 2026-08-05
~12:40 CEST). **This is the live starve the human asked to fix** — not the
Host-bridge question queue.

Related (do not conflate)
- **Misdiagnosis earlier today:** a Cursor session treated “swarm starve” as
  Host `pendingPrompts` / BL-810 and shipped clear-all + 72h TTL + BL-811
  review. That work may still be valid as the BL-810 feature, but it did
  **not** cause or cure this starve. Specifier: keep BL-810/811 on their own
  track; mint **this** defect separately.
- BL-795 (done) — `rule_proposal` actionability + chase redirect; necessary
  but insufficient for today’s failure mode.
- BL-685 (paused) — stranded-resident *detection*; sibling, not this bug.
- BL-719 (paused) — dropped mid-pipeline detector; would have *noticed*
  longer, would not have fixed the chase inject path.
- BL-798 (paused) — open-slot nudge without candidates (promotion-side
  famine); different leg.
- Documented prior shape: `mono_router_lib.bb` `dormant-mailbox-chase-action`
  comment (2026-07-19 BL-508) and
  `handoff_wake_session_test_runner.bb` (dormant roles must remap to resident).

## Goal

1. Specifier mints a **high** defect: under mono-router, chase/delivery wakes
   for dormant roles must land on the resident pane (or rotate onto the
   preferred role) even when handoffd’s process cwd is **not** the project
   root.
2. Acceptance must prove the live failure mode (cwd ≠ project-root), not only
   the unit remap table that already passes when cwd is correct.
3. Optional sibling (separate ticket if wanted): `swarm status` reports
   coder/coordinator `DOWN` while their tmux sessions are alive — confused
   ops during this incident.

## How the swarm starved (causal chain, verified live 2026-08-05)

### Observable symptom

- Human: swarm not churning.
- `backlog/active/` held only **BL-638** (depth cap 1).
- Coordinator and coder panes idle at `NO_TASK` (“active at cap”, empty
  mailboxes).
- Architect (dormant) held a real `git_handoff` for BL-638 since
  **2026-08-05T08:56:59Z**:
  `.worktrees/architect/.swarmforge/handoffs/inbox/new/00_20260805T085659Z_000020_from_cleaner_to_architect_for_architect.handoff`
- Cleaner had already completed and forwarded; the pipeline was waiting on
  architect. Nothing could be promoted while BL-638 occupied the only active
  slot → full self-starve.

### What chase did instead of rotating

From `.swarmforge/daemon/handoffd.log` (same handoffd instance, pid 66770):

- Hundreds of lines: `chase-wake-error architect tmux send-literal failed`
  (also hardender / documenter). Count for architect alone was **~600+**
  from ~08:02Z through the investigation window; total
  `chase-wake-error (architect|hardender|documenter|…)` ≈ **1388**.
- Almost **no** successful `chase-rotate` / `chase-rotate-redirect` lines for
  architect in that window.
- Delivery of the cleaner→architect outbox file also logged
  `error … tmux send-literal failed` then `already-archived` (mailbox copy
  landed; wake did not).

So chase *saw* dormant mail and kept poking, but every poke failed to
inject, and the resident never became architect.

### Root cause (verified, not inferred)

1. **handoffd process cwd is `/Users/ldecorps` (home), not the project root.**
   Confirmed via `lsof -p <handoffd-pid>` → `cwd … /Users/ldecorps`.
   Invocation still passes `<project-root>` correctly as argv; mailbox
   delivery uses that argv (`state-dir`, worktree inboxes) and is fine.

2. **Wake remap / resident lookup use `handoff_lib/target-root`, which is
   cwd-relative** (`git rev-parse --git-common-dir` from the process cwd,
   falling back to `user.dir`). From home, that does **not** resolve to
   `…/swarmforgevc`.

3. Consequence inside `wake-session` / `dormant-mailbox-chase-action`:
   - `mono-router-resident-session` → **nil** (roles.tsv not found at the
     wrong root).
   - `resident-session-exists?` → false.
   - Chase action for architect becomes **`:wake-own-session`** (degrade
     path), not **`:rotate`**.
   - Remap cannot run (`resolve-wake-session` keeps the configured name when
     no resident is known).
   - Inject targets **`swarmforge-architect`**, which does not exist under
     mono-router → tmux: `can't find pane: swarmforge-architect` /
     `tmux send-literal failed`.

4. Reproduced outside the daemon:
   - From project cwd: `wake-session` remaps architect → `swarmforge-coder`;
     chase action is `:rotate`.
   - Calling `notify-agent!` with the remapped session succeeds.
   - Calling inject at `swarmforge-architect` fails with
     `can't find pane: swarmforge-architect`.
   - Loading `handoff_lib` with cwd outside the repo:
     `target-root` → `/private/tmp` (or home), `mono-router-resident-session`
     → `nil` — the same broken posture handoffd has live.

5. Depth-cap amplification: with BL-638 stuck mid-pipeline in a dormant
   mailbox and `active_backlog_max_depth = 1`, coordinator correctly refuses
   new promotes → both standing panes sit on `NO_TASK`. Looks like “idle
   swarm”; actually “blocked on a failed dormant wake.”

### What recovered (ops only — not the fix)

A one-shot `(handoff-lib/rotate-resident-to! "architect")` from a shell whose
cwd was the project root succeeded (`{:ok true}`), respawned the resident as
architect, and the architect pane began `ready_for_next.sh`. That confirms
rotation works when `target-root` is correct; chase under handoffd’s home cwd
still continued to log `chase-wake-error architect` afterward for the same
inject bug.

## Specifier ask

Mint a defect that forces handoffd (and any daemon caller of
`wake-session` / `mono-router-resident-session` / `tmux-socket` /
`rotate-resident-to!`) to resolve project-scoped paths from the **argv
project-root** (or an explicit binding), never from a cwd that happens to be
the launcher’s home.

Invariants worth stating (amend freely):

- A dormant mono-router role with actionable `inbox/new` mail eventually
  produces a resident rotate or a wake on the **resident** session — never
  unbounded `chase-wake-error … can't find pane: swarmforge-<dormant>`.
- `wake-session` remaps identically whether handoffd’s cwd is the project
  root or an unrelated directory.
- Queue departures / Host-bridge polls are out of scope for this ticket.

Out of scope

- Rewriting BL-810 Host queue poll/clear/TTL (already ticketed).
- Replacing mono-router with a full 7-pane pack.
- Closing or re-routing BL-638 itself (ops; pipeline should resume once
  chase rotates correctly).

## Evidence pointers

- `.swarmforge/daemon/handoffd.log` — `chase-wake-error architect tmux
  send-literal failed` storm; delivery `error` on cleaner→architect outbox
  at 08:57:02Z.
- Architect parcel path above; `created_at` 08:56:59Z.
- `ps` / `lsof`: handoffd pid 66770, cwd `/Users/ldecorps`, cmd
  `bb …/handoffd.bb /Users/ldecorps/projects/swarmforgevc`.
- Code: `handoff_lib.bb` `target-root`, `wake-session`,
  `mono-router-resident-session`; `handoffd.bb` `notify!`,
  `chase-poke-and-notify!`, `dormant-mailbox-chase-action` wiring.
- Existing unit coverage that missed this: `handoff_wake_session_test_runner.bb`
  (pure remap table; never runs under handoffd’s real cwd).

## Urgency

Human ordered the starve fixed. Severity **high**: live pipeline halt under
normal mono-router operation, self-sustaining until a human/agent rotates
from a correct cwd. Prefer expedite / priority ahead of console polish.
