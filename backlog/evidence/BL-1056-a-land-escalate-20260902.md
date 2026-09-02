# BL-1056-a land LAND_ESCALATE — 2026-09-02

## Verification result
BL-1056-a (price validity windows / pricing-windows query CLI) fully PASSES QA:
- `npm run compile` clean.
- `test/pricingTable.test.js`, `test/pricingWindows.property.test.js`,
  `test/costTelemetry.test.js`, `test/syntheticLlmCost.test.js`,
  `test/costHealthSidecar.test.js` — 140/140 pass (unit + property lanes).
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1056-a-price-with-an-expiry-date-is-a-query-not-a-memory.feature`)
  — 10/10 pass.
- `specs/pipeline/steps/index.js` registers `bl1056PriceValidityWindowSteps`
  (line 18) — wired.
- Live-checked the ticket's own `qa_e2e_procedure`: costed
  `claude-sonnet-5` at 2026-08-30 (inside window, $12 for 1M/1M tokens) vs
  2026-09-01 (after window, $18) — exact 50% jump; `claude-opus-5`
  (windowless) identical at both instants ($30/$30); `node
  out/tools/pricing-windows.js 2026-09-02` correctly names the closed
  Sonnet window with `daysRemaining: -1`; a fabricated `then: null` window
  and an unpriced model both resolve to `null` (fail-loud, never zero).
- `costTelemetry.ts` calls `estimateCostUsd(record.usage, record.model, new
  Date(record.timestampMs))` — costs at the record's own instant, not
  `new Date()` at read time.
- Full unit (`npm run test`) suite: same 15 pre-existing failing files as
  the corroborated standing-red class (`backlog/evidence/QA-standing-red-
  corroboration-20260828.md`, `BL-1220`/`BL-1221`/`BL-1206`) — identical
  file list to the run performed for BL-1338 this session, none touching
  this ticket's diff.

**Approved commit**: `6e6e54440001adba684d4b3b7551d9e9b0773c6f`
(QA merge of documenter `62a93258d9`).

## Why it cannot land (BL-1241) — same structural cause as BL-1338

`bb swarmforge/scripts/land_step_cli.bb
BL-1056-a-price-with-an-expiry-date-is-a-query-not-a-memory 6e6e544400`
returns `LAND_ESCALATE` with entangled unlanded siblings:
BL-1040, BL-1271, BL-1283, BL-1317, BL-1319, BL-1321, BL-1326, BL-1327,
BL-1330, BL-1334, BL-1338 — the same set already escalated in
`backlog/evidence/BL-1338-land-escalate-20260902.md`, plus BL-1338 itself
(now unlanded, having been QA-approved but blocked by the same escalation).

This is not a fresh issue — it is the same QA-worktree branch entanglement
compounding as each additional ticket clears its own gates and reaches QA.
No new adjudication is requested beyond what BL-1338's evidence already
asked for; this file exists to name BL-1056 in the entangled set so its own
disposition is tracked and it is not silently dropped when the specifier
resolves the underlying entanglement.

Not landing `6e6e544400`; not moving BL-1056 to done.
