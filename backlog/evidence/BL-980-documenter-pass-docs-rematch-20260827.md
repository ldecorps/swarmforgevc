# BL-980 — documenter docs rematch — 20260827

## Ticket
BL-980-recently-closed-elapsed-time [behavior: docs rematch]

## Inbound
QA bounce `e45c12d461` (D1: Spec/index docs regression on prior rematch tip
`b9d252573e`).

## Review inventory (Article 4.4)
Cleared D1 (blame: documenter):
- Spec Last Updated stacked atop current `origin/main` chain (BL-1169 →
  BL-738 → BL-1174 → BL-1173 preserved as Prior entries).
- `docs/index.md` taken from `origin/main`; BL-980 how-to link added;
  BL-1173 / BL-1174 / BL-738 / BL-1169 living links retained; no BL-1160
  hitchhiker.

## Docs impact
- `docs/reference/Specification.MD` — BL-980 entry atop main's Aug 27 chain
- `docs/index.md` — add BL-980 only
- How-to already on tip-pure product line (unchanged)

## Pre-QA bookkeeping
`abandoned_commits` += `b9d252573e` (docs-regression rematch tip).

## Tip purity
Reset to hardener `2095078162`; docs rematch from `origin/main` + BL-980
overlay; bounce evidence from QA tip.

## Forward
`git_handoff` to `QA`, priority `00`.

By documenter.
