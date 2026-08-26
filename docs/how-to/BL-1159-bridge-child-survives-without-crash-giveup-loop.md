# Front-desk bridge child survives without a crash give-up loop (BL-1159)

*How-to. Task-oriented: keep the bridge alive after cold start when the front-desk
supervisor owns the stack.*

## What you'll see

After `./start-swarm.sh` with Telegram configured, the bridge child reaches
`BRIDGE_LISTENING`, then exits **4–6 seconds later**. The front-desk supervisor
logs `:crashed` (pid dead) — **not** `:build-stale`. The cycle repeats until
`gave-up bridge after 5 attempt(s)`, then cooldown re-arms.

Symptoms while the bridge is down:

- `curl -sf http://127.0.0.1:8765/lets-talk` fails during give-up windows
- `https://bubble.musicalsifu.com/resident-spy` returns **502** (origin
  `127.0.0.1:8765` is down; cloudflared ingress is fine)

Manual `rearm_front_desk_bridge.sh` may bring the bridge up briefly but does not
hold without this fix.

## What is already fixed (do not re-open)

| Ticket | What it fixed |
| --- | --- |
| BL-1158 | Dual supervisor on port 8765 — single `front_desk_supervisor` owner |
| [BL-1154](BL-1154-build-stale-restarts-not-crash-giveup-budget.md) | Voluntary build-stale rolls no longer burn the crash give-up budget |
| [BL-1151](BL-1151-front-desk-giveup-one-email-per-episode.md) | One escalation email per give-up episode |

Recompile alone is **not** the fix: on 2026-08-26, `extension/out/BUILD_SHA`
matched `git HEAD` while the crash loop continued.

## Root cause (BL-1159)

`stop_bridge_headless.sh` used `pgrep` to kill every `start-bridge-headless.js`
orphan matching the project root — **even when `front-desk-supervisor.pid` was
live** and owned that child. The operator runtime miniapp watchdog recovery path
invoked stop/bounce after probe failures, SIGTERM-ing the bridge child seconds
after bind.

## What changed

Three deterministic shell edges plus operator orchestration:

1. **`stop_bridge_headless.sh`** — when front-desk supervisor pid is live, **refuse**
   to kill bridge children (log and exit 0). Legacy bridge-only stop still works
   when front desk is absent.
2. **`recover_miniapp_bridge.sh`** — if front desk owns the stack, **re-arm** via
   `rearm_front_desk_bridge.sh`; otherwise fall back to `bounce_bridge_headless.sh`
   (BL-638 legacy path).
3. **`operator_runtime.bb`** — miniapp watchdog bounce calls `recover_miniapp_bridge.sh`,
   not a direct stop/kill path.

`:crashed` now reflects a **true** child exit. Voluntary build-stale rolls remain
on the BL-1154 `"stale-build"` path.

## Operator acceptance anchor

After cold `./start-swarm.sh` with Telegram configured:

- Bridge status JSON shows **running** with a **stable pid** for **10+ minutes**
  without manual re-arm
- `curl -sf http://127.0.0.1:8765/lets-talk` succeeds every minute over that window
- Supervisor log: no repeated `:crashed` / `gave-up bridge` without an intervening
  healthy period
- Named tunnel resident-spy (`bubble.musicalsifu.com` → `127.0.0.1:8765`) returns
  **200** while the bridge is up

Tail `.swarmforge/operator/front-desk-supervisor.log` for `:crashed` vs
`:build-stale` when diagnosing regressions.

## Verify (fixture-backed)

```bash
bash swarmforge/scripts/test/test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh
bash swarmforge/scripts/test/test_recover_miniapp_bridge.sh
bash swarmforge/scripts/test/test_start_stop_bridge_headless.sh
bash swarmforge/scripts/test/test_operator_runtime_tick.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1159-bridge-child-survives-without-crash-giveup-loop.feature
```

## Related

- [BL-1154 — build-stale vs crash give-up budget](BL-1154-build-stale-restarts-not-crash-giveup-budget.md)
- [BL-1151 — give-up one email per episode](BL-1151-front-desk-giveup-one-email-per-episode.md)
- BL-789 — orphan adopt / port-free race (check if crashes persist after this fix)
