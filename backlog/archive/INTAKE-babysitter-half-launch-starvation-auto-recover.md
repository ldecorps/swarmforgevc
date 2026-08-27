# INTAKE — babysitter must auto-recover half-launch and swarm-starvation, not only escalate

**Source:** operator/Cursor, 2026-08-27 ~06:30 BST (post-mortem of morning STARVED incident)  
**Status:** new intake, not minted  
**Priority:** high — recurrence class; hotfix `a8741f5ac` restored handoffd and
launch-contract but the starvation shape can still happen without automatic repair.

## What happened (2026-08-27 ~00:00–06:30 BST)

1. BL-668 left `handoffd.bb` with unmatched parens → handoffd could not start.
2. Freshness cron retried `start_handoff_daemon.sh` every ~6m and failed until
   parse was fixed (`a8741f5ac`).
3. All nine role panes sat at idle `$` shells — **half-launch/exit** (pane alive,
   no `cursor-agent` underneath).
4. Babysitter reported **swarm-starved** for 44+ consecutive sweeps (13 active
   tickets, 7 pending claims, zero in-process, every pane idle).
5. `./swarm ensure` **refused** agent respawns because `cursor-forge.conf` failed
   BL-530 launch-contract (`rotation` unset) until the standing-pack exemption
   in `a8741f5ac`.
6. Operator queue held 145+ stale `BABYSITTER_ESCALATION` events;
   `queue_consuming: false` — escalations alone did not restore motion.

Human/Cursor manually respawned panes and landed the hotfix. Swarm is HEALTHY
again, but the **automatic recovery path for this failure class is incomplete**.

## What auto-heals today (and what does not)

| Finding | Auto-repair? | Mechanism |
|---------|--------------|-----------|
| `control-plane-missing` | Yes | babysitter runs bounded `./swarm ensure` |
| `pane-<role>` (session missing) | Yes | `:ensure-session` → respawn launch script |
| `proc-<role>` (half-launch/exit) | **No** | CRIT + operator escalation only |
| `handoffd` not running | **No** | CRIT text says manual `start_handoff_daemon.sh`; freshness cron tries but cannot fix parse errors |
| `swarm-starved` | **No** | CRIT + coordinator nudge + operator escalation only |

Relevant shipped work already in tree: **BL-958** (babysitter owns `./swarm
ensure` for control-plane-missing), **BL-1017/BL-1018** (bounded per-role
`:ensure-session` for **missing** sessions only), **BL-1071** (ensure actually
runs on WSL).

The half-launch branch in `babysitterd_sweep_lib.bb` `check-live-session`
deliberately omits `:repair` when the pane exists (comment: avoid killing a live
pane). An idle shell after agent exit is indistinguishable from healthy at the
tmux layer and is exactly this morning's shape.

## Request

Mint a defect to close the starvation recurrence class:

1. **Half-launch auto-repair:** when `proc-<role>` CRIT fires (pane exists, agent
   process absent, gather ok) and `session-repair-allowed?`, queue the same bounded
   `:ensure-session` repair used for missing panes — `single-role-repair-lib` /
   `respawn-pane -k` into `.swarmforge/launch/<role>.sh`. Keep the CRIT visible
   (repair must not swallow the alert).

2. **Swarm-starved auto-repair:** when the starved streak crosses a threshold
   (suggest ≥3 sweeps, today was 44), queue `./swarm ensure` (reuse
   `:ensure-control-plane` or a sibling action) **before** or **instead of**
   relying solely on operator escalation — especially when multiple `proc-*`
   findings co-occur.

3. **Acceptance must cover cursor-forge standing pack:** ensure succeeds and
   respawns agents when launch-contract is healthy (regression guard for BL-530
   standing-pack exemption).

4. **Optional follow-up (separate if scope-heavy):** operator queue not consuming
   with 145 pending events — starvation escalations piled up without LLM action;
   do not block (1–2) on operator-runtime diagnosis unless review finds it
   necessary.

## Out of scope

- Re-litigating BL-668 parse fix (landed `a8741f5ac` / BL-1163).
- Full `./start-swarm.sh` relaunch as the default repair (BL-1017 posture:
  disproportionate).
- Mono-router rotation semantics.

## Evidence pointers

- `.swarmforge/operator/events.jsonl` — `proc-*` half-launch + `swarm-starved`
  escalations 2026-08-27.
- `.swarmforge/daemon/daemon-start-audit.log` — repeated handoffd FAILED until
  parse fix.
- `swarmforge/scripts/babysitterd_sweep_lib.bb` — `check-live-session` half-launch
  branch (~125–129), `check-swarm-starved` (~347–363).
