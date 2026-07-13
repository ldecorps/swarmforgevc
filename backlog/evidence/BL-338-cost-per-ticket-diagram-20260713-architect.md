# BL-338 cost-per-ticket-diagram — architect review (20260713)

Merged cleaner 26ef0a3f9c (merge-base 9b7ce40619). No coder/cleaner evidence
file was left in `backlog/evidence/` for this ticket; reviewed from the diff
and source directly.

## Hard gate (BL-259)
`node extension/out/tools/dependency-gate.js` against the changed TypeScript
sources (`src/metrics/costPerTicket.ts`, `src/notify/costHealthSidecar.ts`),
after a clean `npm run compile`: **PASSED — no forbidden edges.** (The
`pwa/*` and `extension/scripts/render-cost-per-ticket-chart.js` changes are
plain browser JS / a jsdom test harness respectively, outside the
dependency-cruiser ruleset's scope — same as every prior PWA-touching
ticket.)

## Co-change (BL-255, informational)
Only the ticket's own new/edited files co-change with each other — no
unexpected cross-cluster coupling. No send-back warranted.

## Two-surface architecture rule (local-engineering.prompt, item 5)
This was the load-bearing check: cost/telemetry data is machine-local
(session logs, resource-sampler files), and the static PWA may only ever
carry data derivable from git state at a SHA. Verified from source, not
assumed:
- `costHealthSidecar.ts`'s own header comment (pre-existing, BL-213):
  the sidecar is "a deterministic, **committed** carrier
  (`docs/briefings/<date>.json`)" — i.e. cost/health data reaches the PWA
  only after being committed to git as a dated snapshot, never as a live
  read of `.swarmforge/`/session-log state.
- This ticket's `costPerTicket` field is purely additive to that same
  already-committed sidecar object (`buildCostHealthSidecar`'s new optional
  parameter), rendered into the SAME pre-existing "Cost & Health" PWA
  section `pwa/app.js` already had (BL-272/BL-273) — it does not open a new
  data path, so it inherits the already-reviewed committed-carrier
  compliance rather than introducing a new one.
- Confirms this correctly targets the STATIC PWA per the ticket's own
  scope, not the live holistic UI — the two surfaces were not confused.

## Correctness checks
- `totalCostByTicket`/`accumulateRoleTicketCosts` never treats an unpriced
  ticket as `$0` — absent-vs-null-vs-summed is modeled explicitly and
  matches `COST_PER_TICKET_BASIS`'s own stated accounting.
- Rework/bounce cost inclusion: confirmed by design, not just by comment —
  `attributeUsageToTickets` (pre-existing, `costTelemetry.ts`) buckets every
  holding-window's usage under the same `ticketId` regardless of which
  bounce produced it, so summing `byTicket[ticketId]` already includes every
  round of rework with no separate mechanism needed.
- BL-312 non-double-count basis: `costTelemetry.ts` still carries its BL-312
  combined-role-group comment; `costPerTicket.ts` aggregates
  `costTelemetryByRole`'s output unchanged, so it inherits the correction
  rather than re-deriving role grouping itself.
- The accounting-basis string rides on the data (`CostHealthSidecar.costPerTicket.basis`)
  rather than being separately typed per surface, so the PWA and the
  briefing email render an identical statement — no drift between surfaces.

## Verification run
- Fresh `npm run compile`: clean.
- `npx vitest run` in `extension/`: 234 files / 3296 tests, all green.
- Drove this ticket's own acceptance feature live
  (`BL-338-cost-per-ticket-diagram.feature`): 6/6 scenarios pass, including
  the real-jsdom-rendered-PWA scenario (`render-cost-per-ticket-chart.js`)
  confirming the diagram genuinely reaches the PWA DOM, not just the
  underlying data.

No correctness or architecture defect found.

## Verdict
PASS. Forwarding to hardener.
