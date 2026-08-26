# Multi-branch parsers need one test per arm (BL-755)

## Rule

A run-touched function whose body is a `cond` / `case` / if-else chain with
**≥3 arms** must have a **distinct exercising test per arm** before `/pilot`
land. Covering only the hazard the ticket narrates leaves other arms dark
(BL-661 / `take-flow-reason`).

Arm evidence is a test whose body includes that arm's marker (string /
keyword literal in the clause) — not merely naming the branch in a comment.

## Surfaces

| Surface | Location |
| --- | --- |
| Hardener role prompt | BL-755 section in `swarmforge/roles/hardener.prompt` |
| `/pilot` brief | `composePilotExpeditorPrompt` (hardener hat) |
| Land gate | `checkMultiBranchParserCoverage` → `reasonKind: untested-parser-branch` |

## Land-gate semantics

- Scope: functions modified in the run — not whole-repo parsers.
- Threshold: ≥3 arms (`MIN_PARSER_ARMS`).
- No-op when the run touches no multi-arm parser.
- Fail open with warning when touched-file history cannot be resolved.
- Refused land is inert (no yaml move, no receipt).
- Clean land records `multiBranchParserCoverage.parsersScanned` on the
  acceptance receipt.

Full gate narrative:
[BL-727 how-to — multi-branch section](BL-727-pilot-acceptance-contract-gate.md).

Companion remaining-work coverage for `take-flow-reason` itself: BL-754 /
[stage_skip_reasons never silently loses a stage](BL-754-stage-skip-reasons-never-silently-loses-a-stage.md).

Acceptance:
`specs/features/BL-755-pilot-multi-branch-parser-needs-per-arm-tests.feature`
