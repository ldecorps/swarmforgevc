# INTAKE — operator_runtime miniapp watchdog SIGTERM-kills front-desk bridge (502 at bubble)

**Source:** human via Cursor hotfix, 2026-08-26 ~14:05 BST  
**Severity:** high (Bubble / Resident Spy down; recurring gave-up + cloudflared 502)  
**Status:** new intake, not minted. Specifier: mint and spec (defect / reliability).

## Operator directive (locked)

Human asked to **hotfix now** and **notify the swarm** after root-cause dig:
`operator_runtime.bb` miniapp watchdog → `bounce_bridge_headless.sh` →
`stop_bridge_headless.sh` kills every `start-bridge-headless.js` for this root,
including the bridge **front_desk_supervisor.bb** just spawned. Start path
already defers to front desk (BL-1158 partial); **stop/bounce does not**.

**Ops hotfix applied 2026-08-26:** `OPERATOR_MINIAPP_WATCHDOG_ENABLED=0` in
`.swarmforge/swarm.env`; `start_operator_runtime.sh` now sources that file;
bridge re-armed; tunnel relaunched.

## Evidence (2026-08-26)

Correlated timestamps between `runtime.log` and `front-desk-supervisor.log`:

| Time (UTC) | operator_runtime | front desk |
|------------|-------------------|------------|
| 12:50:31 | miniapp-watchdog **bounced** failures=3 | crash loop |
| 12:52:34 | miniapp-watchdog **bounced** failures=4 | adopt bridge → crashed 4s later |
| 12:54:42 | miniapp-watchdog **bounced** failures=4 | gave-up cycle |

Manual bridge test with front desk stopped still received **SIGTERM (exit 143)
at ~7s** while `operator_runtime.bb` remained up.

`stop_bridge_headless.sh` lines 44–48: `pgrep start-bridge-headless.js.*ROOT`
→ `kill -TERM` with no check for `front-desk-supervisor.pid`.

## Goal (durable fix — not the hotfix)

1. When front desk owns the stack, **only front desk** may restart/kill the
   bridge on `:8765`.
2. `miniapp-bounce-bridge!` must call `recover_miniapp_bridge.sh` (re-arm front
   desk) instead of full `bounce_bridge_headless.sh` when
   `front-desk-supervisor.pid` is alive — or watchdog must be a no-op in that
   mode.
3. `stop_bridge_headless.sh` must refuse to kill bridge children when front desk
   supervisor is alive (belt-and-suspenders).
4. Acceptance: bridge survives 60s with operator_runtime up; no
   `miniapp-watchdog bounced` while `/lets-talk` is 200; Bubble URL 200.

## Related

- BL-763 (bounce meta + always-on path introduced miniapp watchdog)
- BL-1158 partial (start_bridge_headless defer only)
- BL-1154 (build-stale vs crash budget — separate; this is external SIGTERM)
- Prior intake: cron lifecycle symmetry (`INTAKE-start-swarm-stop-swarm-cron-lifecycle.md`)

## Mint hint

Type: **defect**. Epic: swarm-reliability / front-desk. Priority: high — production
Bubble path. Expedite reasonable.
