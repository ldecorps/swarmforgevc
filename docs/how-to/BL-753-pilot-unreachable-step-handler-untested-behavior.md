# Unreachable step handlers are untested-behavior flags (BL-753)

## Rule

A registered acceptance step handler whose pattern never matches any step the
ticket's feature file renders is **not** cosmetic dead code until you answer:
what claim was this step meant to verify, and is that claim tested any other
way?

## Surfaces

| Surface | Location |
| --- | --- |
| Cleaner / hardener / architect prompts | BL-753 sections in `swarmforge/roles/*.prompt` |
| `/pilot` brief | `composePilotExpeditorPrompt` |
| Land gate | `checkUnreachableStepHandlers` → `reasonKind: unreachable-step-handler` |

Companion remaining-work ticket for BL-694's missing Examples row:
[BL-752](BL-752-residual-allowlist-non-stage-backlog-path-is-tested.md).

Acceptance:
`specs/features/BL-753-pilot-unreachable-step-handler-untested-behavior.feature`
