# BL-581 Hardener Pass

**Date:** 2026-08-29  
**Hardener:** hardener  
**Ticket:** BL-581 — documenter owns diagram currency

## Summary

BL-581 is a constitution/prompt-only change. No code was modified, so there is nothing to mutation-test, coverage-measure, or CRAP-score. The hardening pass verifies that the changes are well-formed and do not introduce inconsistencies.

## What was changed

### Constitution/prompt files
- `swarmforge/constitution/articles/01_roles.md`: added diagram currency to the documenter's responsibilities (section 1.7)
- `swarmforge/constitution/articles/local-engineering.prompt`: generalized the diagram change-trigger clause from "swarm-workflow diagram only" to "every registered diagram"

## Verification

- Read both files to confirm the changes are syntactically valid Markdown
- Confirmed the documenter's responsibilities now include: "When a parcel changes a mechanism that a registered diagram depicts, updating that diagram is part of the SAME parcel"
- Confirmed the local-engineering.prompt's "Diagrams (this project)" section now states: "the documenter keeps them current in the same parcel that changes what they depict"

## CRAP/DRY/Mutation

Not applicable — no source code was changed. This is a docs-only parcel.

## Conclusion

BL-581 is hardened (no hardening needed). The constitution changes are well-formed and consistent. Ready for documenter.
