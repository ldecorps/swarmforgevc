# BL-580 — hardener pass — 20260825

## Inbound

Architect tip `4a77b22acc` (review inventory NONE). Recreated
`swarmforge-hardender` on that tip (no hitchhike from prior BL-695 work).

Same batch also carried BL-626 + coordinator/architect drop notes:
BL-626 tip `ecf9d42f47` was **not** merged or hardened (paused / drop order).
BL-695 hitchhike parcel already archived earlier this turn.

## Host / cooldown

| File | Decision |
|---|---|
| `extension/src/tools/render-briefing-diagrams.ts` | **skip-cooldown** |
| `docs/diagrams/front-desk-flow.mmd` | run (not a Stryker target) |

Load ~3 on 20 cores.

## Language mutation

Stryker skipped (cooldown on the only TS touch). Soft Gherkin mutation
`outcome: inapplicable` (no Scenario Outline) — fell back to hand-authored
surgical sweep (BL-638):

| Mutant | Result |
|---|---|
| drop front-desk allowlist entry | killed |
| rename front-desk → front-desk-x | killed |
| wrong mmd filename in allowlist | killed |
| corrupt front-desk-flow.mmd syntax | killed |

Survivors: 0.

## Gates

| Gate | Result |
|---|---|
| Unit (`renderBriefingDiagramsCli`) | **4/4** (after compile) |
| Acceptance | **2/2** |
| Surgical sweep | **4/4 killed** |

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-580-front-desk-mechanism-briefing-diagram`.

By hardener.
