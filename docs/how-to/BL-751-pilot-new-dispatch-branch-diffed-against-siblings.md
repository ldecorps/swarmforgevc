# A new dispatch branch must be diffed against its siblings' gating pattern (BL-751)

## Rule

When a parcel adds a new case/branch to a function whose **existing** arms
already share a structural pattern — a timeout, grace period, or guard
condition applied uniformly — a review hat (hardener, or `/pilot` wearing
that hat) must diff the new arm's structure against its siblings before
passing. A shared pattern silently dropped on the new arm is a defect
candidate, not a style nit: flag it for an explicit decision (follow the
pattern, or document the deviation) rather than let it land as a silent
omission.

## Why

BL-646 added a `:warn-fixture-droppings` arm to `babysitter_assess_lib.bb`'s
severity `cond` without the `(>= elapsed-pct 0.75)` grace-period guard its
two sibling arms (`:warn-uncommitted`, `:watch`) both carry — and, being
first in the `cond`, it also shadowed the gated sibling. Three review passes
missed it because each read the new arm in isolation, never against its
siblings (companion ticket BL-750).

## Where it lives

| Surface | Location |
| --- | --- |
| Hardener role prompt | `swarmforge/roles/hardender.prompt` — section BL-751 |
| `/pilot` brief | `composePilotExpeditorPrompt` in `extension/src/tools/telegramCursorBridgePilot.ts` |

Companion remaining-work ticket for the underlying BL-646 gap: BL-750.
