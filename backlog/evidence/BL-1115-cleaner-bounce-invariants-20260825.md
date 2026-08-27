# BL-1115 cleaner bounce — property invariants rematch — 2026-08-25

## Inbound

Coder tip `1f3deb01c9` was stacked (BL-1119 + architect merge ancestry) and
included `hotfix-ledger.yaml`. Rematched **1115-only** onto `origin/main`
=`7e430470c0`:

1. Cherry-pick `bcba05b8e` + `48ed53f75` + prior cleaner evidence
2. Checkout from tip: property test, pending ledger row, bounce/rematch
   evidence

Did **not** bring BL-1119. Ledger pending row for `a3bf11b533` /
`stamp_ticket: BL-1115` is stamp-off product (invariant 2 needs a live
row), not a hitchhiker.

## Checks run

1. Hotfix blob identity — match `a3bf11b533`
2. Property — `bl1115MainSyncStatusCliStampOff.property.test.js` — 2/2
3. Gherkin — BL-1115 feature — 7/7

## Cleanup performed

NONE — property encodings are small and share `gitShow` / `ledgerEntry`
helpers; no further DRY without inventing structure.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1115-invariant-unencoded-missing-property-tests`.

By cleaner.
