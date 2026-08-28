# BL-1217 — architect pass, 2026-08-28

Commit reviewed: 30515dc931 (cleaner, verifying coder work bd9dfee09).

## Architecture
Pure babashka, gated at the single shared seam (`expected-rc-name`) every
repair path already calls through `check-role`/`actionable?` — no new
predicate, no per-call-site opt-in. Reuses `backlog-depth-lib/conf-file-path`
and `coordinator-config-lib/raw-config-value` (existing shared readers,
per the ticket's explicit "do not hand-roll a third conf reader"
constraint) rather than inventing new config-parsing.

## required_wiring (deliberately absent, per ticket notes)
The specifier's own note explains why: the literal `remote_control`
already appears in this lib's header comments, so any required_wiring
pattern naming it would be vacuous (matches at any commit). Verified this
reasoning is sound, and independently confirmed invariant 3 by grep
instead: `swarm_ensure.bb` (line 769) and `remote_control_respawn.bb`
(line 110) both call `expected-rc-name` directly; `remote_control_health.bb`
calls `check-role`, which calls `expected-rc-name` internally (line 258).
All three real repair paths route through the one gated seam.
`orphan_agent_reaper_sweep_lib.bb` only reaps orphaned processes and never
respawns/repairs RC — confirmed by grep, needed no change.

## Invariants (all three declared, verified)
1. Config off → no respawn/re-attach — scenarios 18-20, acceptance
   "a deliberate config off is never repaired, whatever the seat looks like".
2. Config on/absent → byte-for-byte today's behavior — scenarios 21-22,
   acceptance "config on preserves today's repair behaviour exactly" /
   "an absent remote-control config behaves exactly as on".
3. One source of truth, every repair path — confirmed by grep above and
   acceptance "every repair path shares the one gate".

## Non-vacuity — independently re-verified
Checked out the pre-fix baseline (bd9dfee09^) in a throwaway worktree,
copied over just the new test file, and confirmed scenario 18 genuinely
FAILS there ("expected-rc-name must be nil when config says off... got:
SwarmForge-Coder") while scenarios 01-07 still pass — then confirmed
22/22 green on the actual fix.

## Constraints
- `:off` is not reported as a fault (scenario 20's exit-status framing;
  unchanged `:off` handling in `actionable?`/`classify`).
- Absent config = on, verified (scenario 22).
- Unreadable conf file fails open to "on" (`(catch Exception _ "")`) —
  never a spurious `:off`.

## Verification run
- `test_remote_control_health.sh`: 22/22 pass (5 new for BL-1217).
- BL-1217 acceptance feature: 8/8 pass.

NONE outstanding. Forwarding to hardener.

By architect.
