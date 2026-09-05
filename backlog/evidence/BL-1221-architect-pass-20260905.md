# BL-1221 — architect pass, 2026-09-05

Ticket: BL-1221-pilot-gate-deps-stubs-missing-required-orphan-docs-check
Role: architect
Commit reviewed: 66a44b5899 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1221PilotGateDepsStubsSteps.js`) and full-repo:
  `Dependency-rule gate PASSED: no forbidden edges.` in both. The change
  is 15 near-identical, single-line stub additions in test files plus one
  step handler — no production code, no webview, no VS Code API, no
  secrets, no browser storage.
- **Co-change report** (two representative files, given the mechanical
  uniformity of the fix): only the pilot-gate family's own dense,
  pre-existing pairwise coupling (a shared, evolving contract naturally
  touches many sibling test/step files together) — nothing new or
  suspicious.

## Sole invariant, verified against both the fix and the constraints

"Every test stub satisfying `landPilotedTicket`'s deps supplies every
member the contract declares required — a test fails on its own
assertion, never on a missing dep." Confirmed:

- `checkOrphanedAuthoredDocs` now appears in all 15 real caller files
  (`grep -rl "landPilotedTicket(" extension/test/*.js` — independently
  re-run myself, 15 files, exact match with the 15 files carrying the new
  stub member).
- The production contract is unchanged: no diff to
  `pilotAcceptanceGate.ts`/`pilot-acceptance-gate.ts` — the member is
  still required, the call site at line 609 is still unconditional
  (confirmed by `git diff` showing zero production file changes).
  `npm run compile` runs clean.
- No existing assertion was weakened: every diff hunk is a pure addition
  of one stub line to an existing `mkDeps`/inline `deps` object.

## The design question the ticket left open — correctly resolved

The ticket's own "How" direction offered a shared factory OR in-place
edits depending on whether the 15 stubs are near-identical. The
cleaner's own pass confirmed none of the 15 files had a pre-existing
shared stub helper to extend, so in-place edits (one added line each) was
the correct choice per the ticket's own "do not force a shared helper
that distorts what individual tests are asserting" guidance — a fifteenth
near-identical hand-edit is not a duplication problem worth a new
abstraction.

## A self-correction worth noting: the ticket's own "16" was stale

The ticket's title/description says 16 callers; the coder recounted and
found the real number is **15** — two independent methods
(`grep -rl "landPilotedTicket("` and "which files' own mkDeps supplies
the fix") converge on 15, with the extra 2 grep hits for the bare name
`landPilotedTicket` (no open-paren) being non-calling references
(`multiworktreeAcceptanceFixture.test.js`'s wiring-anchor string,
`pilotAcceptanceGateCli.test.js`'s comment). I independently reproduced
both counts myself and confirm 15 is correct — not a defect in this
parcel, a stale measurement in the ticket's own mint-time count, correctly
caught and documented rather than blindly matched to a wrong number.

## Independently re-verified the substance

- Ran all 9 `.test.js` files under the unit config myself: 9/9 files,
  95/95 tests pass — matches the coder/cleaner's claim exactly.
- Ran all 6 `.property.test.js` files under the properties config myself:
  3 pass fully (15/15 tests: `multiBranchParserCoverageCheck`,
  `perHatRolePromptEvidenceCheck`, `unreachableStepHandlerCheck`), 3 fail
  to COLLECT with "No test suite found"
  (`bl733ProducerCrosscheck`/`pilotAcceptanceGate`/
  `pilotScopedCrapEvidence`, all `.property.test.js`) — matches the
  coder's claim exactly, and NONE shows the
  `deps.checkOrphanedAuthoredDocs is not a function` error.
- **Went further than the coder/cleaner's own evidence**: to confirm the
  3 collection failures are genuinely BL-1220's pre-existing defect and
  not something this parcel's edit newly caused, I checked out the
  PRE-parcel version of `bl733ProducerCrosscheck.property.test.js` into
  the live tree and re-ran it — it fails to collect identically
  ("No test suite found"), confirming the defect predates this parcel's
  touch and is unrelated to the stub addition. Restored the file
  afterward; `git status` clean.

## Acceptance wiring

Feature declares 3 scenarios / 3 scenario runs. Independently drove
`bl1221PilotGateDepsStubsSteps.js::registerSteps` against all 3 — each
step drives the REAL compiled `landPilotedTicket` (from `extension/out`)
against a real, fully-supplied deps stub — all passed. The step handler's
own `CALLER_FILES` list (15 entries) matches my independent grep exactly.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
