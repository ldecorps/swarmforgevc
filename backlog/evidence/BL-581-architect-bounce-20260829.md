# Architect Bounce: BL-581-documenter-owns-diagram-currency

**Reviewed commit**: b09d1e64e (specifier)
**Review date**: 2026-08-29
**Reviewer**: architect
**Verdict**: BOUNCE — implementation incomplete

## Defect

The parcel contains only the feature file (acceptance criteria) and ticket metadata update. The actual constitution/prompt edits requested by the ticket have not been made.

### What the ticket asks for (verbatim from description)

"## Change

Constitution/prompt edits only - the specifier's own remit, no code.

1. `01_roles.md` 1.7: add diagram currency to the documenter's responsibilities - when a parcel changes a mechanism that a registered diagram depicts, updating that diagram is part of the SAME parcel, not a follow-up ticket. The documenter is the role that verifies this before forwarding to QA.

2. `local-engineering.prompt` "Diagrams (this project)": list all four diagrams (architecture, swarm-flow, handoff-flow, front-desk-flow), give EACH one an explicit change-trigger sentence naming what kind of change obliges an update, and replace "Both live under" with wording that does not encode a count.

3. State the registry rule once, plainly: any `.mmd` in `render-briefing-diagrams.ts`'s DIAGRAM_FILES allowlist MUST have an entry here with its own change-trigger. That makes the allowlist and the constitution mutually checkable - a diagram in one and not the other is a visible defect rather than a silent drift."

### What the parcel contains

- specs/features/BL-581-documenter-owns-diagram-currency.feature (NEW - acceptance criteria)
- backlog/active/BL-581-documenter-owns-diagram-currency.yaml (UPDATED - acceptance field now points to feature file, qa_e2e_procedure added)

### What is missing

1. **01_roles.md section 1.7** - not modified. Should add diagram currency to documenter's responsibilities.
2. **local-engineering.prompt Diagrams section** - not modified. Should list all four diagrams with change-triggers, remove count-encoding wording.
3. **Registry rule statement** - not added. Should state that DIAGRAM_FILES and constitution must match.

## Why this is a problem

The specifier created the feature file (good), but the feature file is the acceptance criteria, not the implementation. The ticket explicitly asks for three constitution/prompt edits, and none have been made. The parcel cannot pass architectural review because there is no implementation to review.

The feature file's scenarios check properties of 01_roles.md and local-engineering.prompt that do not yet exist. Running the acceptance tests would fail because the constitution hasn't been updated.

## Remediation

The specifier (or coder, if this is forwarded to implementation) must make the three constitution/prompt edits described in the ticket:

1. Edit `swarmforge/constitution/articles/01_roles.md` section 1.7 to add diagram currency to the documenter's responsibilities
2. Edit `swarmforge/constitution/articles/local-engineering.prompt` Diagrams section to list all four diagrams with change-triggers
3. Add the registry rule statement to the Diagrams section

After the edits are made, the parcel can be forwarded to the architect for review.

## Note on scope

The parcel also includes files from main that were merged into the cleaner's branch (INTAKE file, BL-1222 ticket, open_swarm_spy_grid.sh scripts). These are not part of BL-581 and are not a scope violation - they're just merge artifacts. The actual BL-581 work is only the feature file and YAML update.
