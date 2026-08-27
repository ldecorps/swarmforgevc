# INTAKE — Front desk bridge child crash-loops after BL-1158/1154 (not build-stale)

**Source:** human via Cursor, 2026-08-26 ~13:17 BST  
**Surface:** `front_desk_supervisor.bb`, bridge child
(`extension/out/tools/start-bridge-headless.js` → `bridgeServer.ts`), supervisor
status in `.swarmforge/operator/front-desk-supervisor.status.json`, log:
`.swarmforge/operator/front-desk-supervisor.log`.

Status: **new intake, not minted.** Specifier: mint and spec (defect / high).
**Expedite:** front desk offline; `bubble.musicalsifu.com/resident-spy` 502 when
bridge down. **human_approval:** approved.

## What is already fixed (do not re-open)

| Ticket | Status | What it fixed |
|--------|--------|----------------|
| BL-1158 | done | Dual supervisor on 8765 — single `front_desk_supervisor` owner |
| BL-1154 | done | Build-stale restarts no longer burn crash give-up budget |
| BL-1151 | done | One escalation email per give-up episode |

Recompile is **not** the operator fix here: on 2026-08-26 ~13:17,
`extension/out/BUILD_SHA` matched `git HEAD` (`a19dce261…`). Aligning compile
to tip did not stop the crash loop.

## Observed failure (live, 2026-08-26)

Bridge child repeatedly **exits** ~4–6 seconds after starting:

```
started bridge pid=… attempt= N
BRIDGE_LISTENING port=8765
crashed bridge attempt= N        ← :crashed (pid dead), not :build-stale
```

Cycle continues until `gave-up bridge after 5 attempt(s)`, then cooldown
re-arm. Bot often stays `running`; bridge oscillates `running` → `waiting` →
`gave-up`.

**Impact:**

- `curl -sf http://127.0.0.1:8765/lets-talk` — fails during give-up windows
- `https://bubble.musicalsifu.com/resident-spy` — **502** when origin
  `127.0.0.1:8765` is down (cloudflared config/URL is correct)
- Manual `rearm_front_desk_bridge.sh` brings bridge up briefly; it does not hold

No timestamped `EADDRINUSE` observed post–BL-1158 restart — this is not the
dual-supervisor fight.

## Root cause (direction for specifier)

**Unknown child exit** after successful bind — supervisor sees `pid-alive?`
false and logs `:crashed`. Distinct from BL-1154 voluntary `:build-stale` rolls
(which preserve `:attempts`).

Investigate:

1. Bridge stderr between `BRIDGE_LISTENING` and exit (supervisor log / inherit)
2. Whether supervisor or another actor kills the child (build-stale restart,
   port adopt/free race, orphan reap)
3. Bridge process stability when run manually with `BRIDGE_TOKEN` vs under
   supervisor spawn env
4. Bot build-stale restart pulling bridge respawn in same tick (bridge+bot order)

## Locked human decision

After `./start-swarm.sh` with Telegram configured, the bridge must stay
`running` and serve `/lets-talk` for **10+ minutes** without manual re-arm,
while the swarm continues landing tickets on `main`. Resident-spy named tunnel
(`bubble.musicalsifu.com` → `127.0.0.1:8765`) must return 200, not 502.

## Acceptance signals (specifier → Gherkin)

1. Bridge child survives ≥10 minutes after cold start; status JSON shows
   `bridge.status: running` with stable pid.
2. `curl -sf http://127.0.0.1:8765/lets-talk` succeeds continuously over that
   window.
3. Log shows no repeated `:crashed` / `gave-up bridge` cycle without an
   intervening healthy period.
4. `https://bubble.musicalsifu.com/resident-spy` returns 200 over the same
   window (origin up — not a cloudflared URL change).

## Out of scope

- Dual supervisor / EADDRINUSE ownership (BL-1158)
- Build-stale vs crash budget accounting (BL-1154)
- Give-up email policy (BL-1151)
- Wrong cloudflared hostname (ingress is correct; 502 is symptom of bridge down)

## Related

- BL-1158, BL-1154, BL-1151 (all done)
- BL-789 (orphan adopt — check port-free race)
- Archived `INTAKE-front-desk-bridge-giveup-email-spam.md`
- Local operator note superseded by this intake:
  `.swarmforge/operator/INTAKE-front-desk-bridge-build-stale-giveup-after-bl1158.md`
