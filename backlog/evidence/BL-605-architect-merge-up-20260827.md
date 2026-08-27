# BL-605 — architect merge-up — 20260827

## Inbound

QA note: `BL-605 QA-approved 7c15ad7c8c (acyclic rematch) — merge your branch up to QA's`
(handoff `001653`).

## Action

Full merge skipped. Tip-pure path for acyclic rematch:

1. Land `globalTokenConsumption` product + steps from prior QA land `12e961bb31`
2. Apply coder acyclic fix `f36e2fbaf` (`trend.ts` does not re-export)
3. Keep BL-601 no-re-export comment alongside BL-605
4. QA pass evidence `BL-605-qa-pass-acyclic-rematch-20260827.md`
5. APS 4/4, unit 7/7; `-s ours` for `7c15ad7c8c`

## Result

- Architect tip records QA land `7c15ad7c8c` as ancestor
- Metrics graph remains acyclic

By architect.
