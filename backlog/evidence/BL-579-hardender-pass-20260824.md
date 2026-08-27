# BL-579 — hardender pass — 20260824

## Inbound

Architect tip `fca00598e5`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip — did not merge hitchhiked ancestry.

Hitchhike gate before handoff:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Scope

Morning-briefing allowlist adds `handoff-mechanism` → `handoff-flow.mmd`.
Explicit `DIAGRAM_FILES` (not a directory scan). No production code delta
this pass; locks already kill allowlist regressions.

## Host / cooldown

`mutation_cooldown_gate.bb` absent on this tip (degraded). Soft Gherkin
**inapplicable** (no Example mutations). Surgical below is the kill check.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| drop handoff allowlist entry | killed |
| wrong diagram name | killed |
| wrong source file | killed |
| fixture omits handoff-flow.mmd | killed |
| unit expect drops handoff name | killed |

Survivors: 0.

## Verification

- Compile OK
- Unit (`renderBriefingDiagramsCli.test.js`) **4/4**
- Acceptance **3/3**

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-579-handoff-mechanism-briefing-diagram`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
