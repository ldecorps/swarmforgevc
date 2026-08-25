# BL-833 — architect pass — 20260825

**Tip:** cleaner `dfad7cb354` (coder `bb98f87e9`)
**Handoff:** `50_20260825T122633Z_000796_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...dfad7cb354` = **10 paths**, BL-833-only. Hitchhike CLEAN.
Feature already on main; tip adds feed module, live tee, bridge route/SSE,
units/properties, APS steps, ticket + coder/cleaner evidence.

## Architecture

- New `hostActivityFeed.ts` owns bounded per-session buffer (host-side
  singleton — not webview storage).
- Tee-not-reroute: `reportProgress` calls `recordHostActivity` then the
  existing Telegram throttled reporter; Telegram cadence unchanged.
- Bridge serves catch-up `GET /host-activity` via `buildJsonRoutes` and
  pushes `event: host-activity` on the existing authenticated `/events`
  SSE client set — same auth gate as other read routes (`isAuthorizedForRead`
  before JSON/`/events`).
- Session begin/end wraps the live prompt turn in
  `telegramCursorBridgeLive.ts`.
- Integrate-not-fork; no transcript walker / invented progress.

## Dependency-rule gate

```
cd extension && node out/tools/dependency-gate.js \
  src/bridge/hostActivityFeed.ts src/bridge/bridgeServer.ts \
  src/tools/telegramCursorBridgeLive.ts
→ PASSED: no forbidden edges.
```

Full-repo `dependency-gate.js` → **PASSED**.

## Co-change

Advisory: new feed co-travels with bridgeServer / live bridge / tests —
expected for this ticket. Historical live↔core coupling pre-existing.
No send-back.

## Invariants (3 declared) — encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Feed contains only emitted lines | `hostActivityFeed.property.test.js` + unit | ALL PROPERTIES HOLD; 6/6 units |
| 2 | Feed bounded (oldest evicted) | Same property + bound unit | green; bound=128 |
| 3 | Observing never damages turn | `recordHostActivityLine` try/catch + append-hook unit | doesNotThrow on disk-full hook |

## Property-testing support (undeclared)

Declared property covers emit-only + bound + quiet-after-end. Best-effort
write covered by unit (throw seam). No additional property authored this pass.

## Correctness

- `node --test test/hostActivityFeed.test.js` → **6/6**
- `node test/hostActivityFeed.property.test.js` → ALL PROPERTIES HOLD
- APS `BL-833-host-agent-activity-feed.feature` → **8/8**
- Required wiring needles present (`recordHostActivity` tee; `/host-activity`
  route). No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-833-host-agent-activity-feed`, commit = this tip.
Authorize BL-833 paths only.

By architect.
