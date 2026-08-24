# BL-1114 — hardener pass, 2026-08-24 (batch with BL-1071)

## Inbound

Merged architect `cd798f06c2` (on cleaner `17efe389d0` / coder
`046358e2ee`) into `swarmforge-hardender` (combined batch with BL-1071).

## Scope

Exhausted dead-letter recovery: terminal note, wake, move `.dead` to
`handoffs/failed/`. Touches `handoffRecovery.ts`.

## Host / BL-149

`handoffRecovery.ts`: **run** (age ~46d). Host quiet. Stryker this pass.

## Process fix this pass

Exported `truncateMessage`; added unit killers for failed-box path,
truncate boundary, note headers, dispose (nested mkdir + missing sidecar).
Scoped mutate to new helpers.

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0
outcome: pass
```

## Stryker (`out/swarm/handoffRecovery.js:73-145`)

```
All files | 96.72 | killed 59 | survived 2
```

Survivors recorded as BL-234 equivalents:

1. Stamp regex `\.\d+Z$` → `\.\d+Z` — interchangeable for
   `Date.toISOString()` (ms always precede terminal `Z`).
2. `writeFileSync(..., 'utf-8')` → `""` — ASCII note body identical under
   Node's default encoding.

## Verification

- Unit 20/20; property 1/1; acceptance 4/4
- Dep-gate PASSED

## Findings

NONE (equivalents documented).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1114-dead-letter-quarantine-must-not-be-silent`.

By hardender.
