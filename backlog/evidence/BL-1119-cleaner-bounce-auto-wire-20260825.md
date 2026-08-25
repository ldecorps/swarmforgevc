# BL-1119 cleaner bounce — auto wire + invariants — 2026-08-25

## Inbound

Coder tip `5d2f140048` was stacked (1115/1120/architect merges). Rematched
**1119-only** onto `origin/main` = `4633d9bf42`:

1. Cherry-pick `b82979e57` + prior cleaner DRY `7a16fffd0`
2. Checkout rematch surface from tip (pack conf → windowModels,
   property suite, run wiring)

## Checks run

1. Hitchhike / stack gate — no 1115/1120 product on tip surface
2. `vitest` closingCeremony + closingCeremonyRun — 45/45
3. Property — `bl1119ClosingCeremonyRoleQualityDial.property.test.js` — 3/3
4. Gherkin — BL-1119 feature — 6/6

## Cleanup performed

NONE on rematch delta — `parseWindowModelsFromConf` / injectable
`readWindowModels` already small (CC ≤ 6); prior DRY on `dialForRole` kept.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1119-auto-dial-unwired-and-invariants-unencoded`.

By cleaner.
