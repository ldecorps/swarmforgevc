# BL-759 — architect pass — 20260825

**Tip:** cleaner `c6fccc1e5a` (coder `993beee166`)
**Handoff:** `50_20260825T115744Z_000794_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...c6fccc1e5a` = **13 paths**, BL-759-only. Hitchhike CLEAN.
Structural extract: drain helpers → `telegramPipelineDrain.ts` /
`controlDrainTimeoutMs` → `telegramControlCore.ts`; bot re-exports; Exec /
Liveness / notify-dead-letters import leaf modules (no back-edge into bot).

## Architecture

- Dependency direction now inward to leaf helpers; bot remains the host CLI
  surface and re-exports for callers that imported from the bot.
- No webview/storage; integrate-not-fork unchanged.
- **Hard gate (full repo):**
  `cd extension && node out/tools/dependency-gate.js` → **PASSED**
  (scoped parcel files also PASSED). The standing three-edge `acyclic`
  cycle this ticket tracked is gone.

## Co-change

Advisory: new drain leaf co-travels with this tip's surfaces; bot's historical
coupling to steps/index is pre-existing. No send-back.

## Invariants (2 declared) — encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Whole-repo dep-gate zero forbidden edges | `bl759CursorOperatorFrontDeskCycle.property.test.js` | 2/2 properties; full-repo gate PASSED |
| 2 | Same implementations after move (re-exports) | Same property file — bot ≡ drain/core bindings | green |

## Property-testing support (undeclared)

Declared suite covers gate + re-export identity. No additional property
authored this pass.

## Correctness

Acceptance **10/10**. Drain/timeout unit filter green. No drain-semantics
defect spotted; Exec→Liveness remains one-way (not a cycle).

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-759-cursor-operator-front-desk-bot-import-cycle`, commit = this tip.
Authorize BL-759 paths only.

By architect.
