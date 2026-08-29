# Architect Review: BL-581-documenter-owns-diagram-currency

**Reviewed commit**: f3c929813e (cleaner)
**Review date**: 2026-08-29
**Reviewer**: architect
**Verdict**: PASS — architecture compliant

## Changes reviewed

1. `swarmforge/constitution/articles/01_roles.md` — added diagram currency responsibility to documenter role (section 1.7)
2. `swarmforge/constitution/articles/local-engineering.prompt` — expanded Diagrams section to list all four diagrams with explicit change-triggers

## Acceptance criteria verification

1. ✅ `01_roles.md` 1.7 names diagram currency as documenter responsibility with same-parcel update requirement
2. ✅ `local-engineering.prompt` lists all four diagrams (architecture.mmd, swarm-flow.mmd, handoff-flow.mmd, front-desk-flow.mmd) with distinct change-trigger sentences
3. ✅ No count-encoding wording remains ("Both live under" trap removed)
4. ✅ Registry matches DIAGRAM_FILES allowlist exactly (verified against `extension/src/tools/render-briefing-diagrams.ts`)

## Architecture compliance

- **Two-layer boundary**: N/A — constitution/prompt files only, no code
- **Extension host I/O ownership**: N/A — no code
- **No browser storage**: N/A — no code
- **Secrets in extension-host only**: N/A — no code
- **Integrate-not-fork**: Changes are to constitution files, not SwarmForge source
- **Dependency gate**: Does not apply to markdown files

## Findings

NONE — clean review pass.

The documenter's role is appropriately expanded to own diagram currency. The registry is in sync with the code's DIAGRAM_FILES allowlist. Each diagram has a specific, checkable change-trigger. The optional executable guard (acceptance criterion #4) was deferred per the ticket's "specifier decides" clause — acceptable.

## Notes

- The ticket's scope is constitution/prompt edits only, no code changes
- The changes respect the specifier's remit (governance documentation)
- No architectural violations detected
