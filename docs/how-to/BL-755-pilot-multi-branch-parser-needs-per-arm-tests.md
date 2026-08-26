# Multi-branch parsers need one test per arm (BL-755)

## Rule

A run-touched function whose body is a `cond` / `case` / if-else chain with
**≥3 arms** must have a **distinct exercising test per arm** before `/pilot`
land. Covering only the hazard the ticket narrates leaves other arms dark
(BL-661 / `take-flow-reason`).

## Surfaces

| Surface | Location |
| --- | --- |
| Hardener role prompt | BL-755 section |
| `/pilot` brief | `composePilotExpeditorPrompt` |
| Land gate | `checkMultiBranchParserCoverage` → `reasonKind: untested-parser-branch` |

Companion remaining-work coverage for `take-flow-reason` itself: BL-754.

Acceptance:
`specs/features/BL-755-pilot-multi-branch-parser-needs-per-arm-tests.feature`
