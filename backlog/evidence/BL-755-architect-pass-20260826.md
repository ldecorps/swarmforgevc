# BL-755 — architect pass — 20260826

- merge_and_process cleaner tip `a593d30d8b` (conflicts in land-gate mock deps:
  kept `checkUnreachableStepHandlers` + `checkMultiBranchParserCoverage` stubs).
- Ticket: refuse /pilot land when a run-touched ≥3-arm parser has an untested
  arm (`reasonKind: untested-parser-branch`); hardender + /pilot prompt rule;
  fail-open warning when history unreadable; no-op when no multi-arm touch.

## Architecture / boundaries

- Pure assessor + extractors in `multiBranchParserCoverageCheck.ts`; git IO in
  `commitClaimGitReader.ts`; land refuse + warning assembly in
  `pilotAcceptanceGate.ts`; CLI wiring in `pilot-acceptance-gate.ts`.
- dependency-gate on parcel sources: **PASSED**.
- co-change: expected coupling with prior land-gate modules (informative only).

## Required wiring

- `checkMultiBranchParserCoverage` called from `landPilotedTicket` before move.
- CLI supplies real check via `commitClaimGitReader`.
- `composePilotExpeditorPrompt` carries BL-755 hardener-hat rule.
- APS `bl755PilotMultiBranchParserNeedsPerArmTestsSteps` registered in index.
- `hardender.prompt` section "A multi-branch parser needs one distinct test per
  branch (BL-755)" present.

## Invariants

1. Untested arm → refuse `untested-parser-branch`: encoded in
   `multiBranchParserCoverageCheck.property.test.js` (+ non-vacuity).
2. Prompt guidance: APS scenarios parser-branch-01/02 (static prompt presence;
   not generative). Behavioral land path is property-covered under (1).
3. No multi-arm touch / unreadable history: empty-parser no-op property;
   `checked: false` → warning on success path.

## Verification

- `node --test` multiBranchParserCoverageCheck.test.js: 6/6.
- vitest properties (same file): 5/5.
- No prior QA bounce for BL-755 on main (specifier-only history).

Pass → hardender.

By architect.
