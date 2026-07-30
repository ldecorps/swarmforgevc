# BL-627 QA pass (re-land, cursor-as-expeditor /pilot)

Date: 2026-07-30

Prior pilot (2026-07-28) stamped done but the land commit dropped off current
`main`; ticket had returned to `backlog/paused/` with v1 wrong rates. This run
cherry-picked `36d9672a1` onto tip `acaa31c77`, resolved Spec/index conflicts,
re-verified.

## Checks

- Unit: `vitest run test/pricingTable.test.js` → 11/11
- Acceptance: `run_acceptance.sh` BL-627 feature → 6/6
- Invariant: coverage check fails loud naming unpriced models; current roster passes

## Result

Pass. Ticket moved `backlog/paused` → `backlog/done`.
