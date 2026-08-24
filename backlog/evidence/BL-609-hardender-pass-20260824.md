# BL-609 — hardender pass — 20260824

## Inbound

Architect tip `5ac0a0a543`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip.

Hitchhike gate before handoff → CLEAN.

## Scope

Resident Spy compact +/- pane font-size (default 13px, CSS variable,
control outside `#fs-head`, no browser storage). No production code delta
this pass; locks already kill the regressions below.

## Host / cooldown

`mutation_cooldown_gate.bb` absent on this tip (degraded). Soft Gherkin
**4/4** killed. Surgical below.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| default 13 → 11 | killed |
| drop min clamp | killed |
| step 1 → 2 | killed |
| crowded delta 2 → 0 | killed |
| mount +/- inside `#fs-head` | killed |
| seed size from `localStorage` | killed |

Survivors: 0.

## Verification

- Unit (font-size + ui html) **15/15**
- Acceptance **7/7**

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-609-resident-spy-font-size-control`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
