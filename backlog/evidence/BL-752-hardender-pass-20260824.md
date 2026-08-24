# BL-752 hardender pass — 2026-08-24

## Parcel
- Task: `BL-752-bl694-unreachable-step-handler-untested-non-stage-basename-case`
- Architect tip: `719e66d92c`
- Harden: planted canary + non-vacuous unmatched assert in
  `specs/pipeline/steps/bl752ResidualAllowlistNonStageSteps.js`

## Gates
- Acceptance feature: 3/3 pass
- Related BL-694: 9/9 pass
- Cooldown: allowlist + steps exercised (run)
- Gherkin soft: inapplicable (no Scenario Outline)

## Surgical (0 survivors)
| Mutant | Result |
|--------|--------|
| basename-outside-stage (allowlist) | killed |
| widen-stage-re | killed |
| drop-stage-gate | killed |
| never-push-unmatched (steps) | killed |
| expect-empty-unmatched → `[]` | killed |

## Intent lock
Non-stage paths (`backlog/topics/...`) must not be excused by basename alone.
Unreachable-handler scenario must fail if the push/assert is removed or made vacuous;
canary `__BL752_CANARY_UNREACHABLE__` proves the guard is not empty-match soft.
