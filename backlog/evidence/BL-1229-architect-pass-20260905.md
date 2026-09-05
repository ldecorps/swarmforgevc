# BL-1229 — architect pass, 2026-09-05

Ticket: BL-1229-pilot-gate-deps-contract-cannot-silently-outgrow-its-test-stubs
Role: architect
Commit reviewed: ce2aa8089f (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1229PilotGateDepsContractStubsSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is test-side only: a new shared stub helper
  (`extension/test/helpers/pilotAcceptanceGateDeps.js`), a completeness
  test, a property invariants test, and 15 test files refactored to build
  on the shared base — zero production diff, no webview, no VS Code API,
  no secrets, no browser storage.
- **Co-change report**: all new, self-referential coupling for this single
  ticket's own helper/test family — nothing pre-existing disturbed.

## The human's ruling, verified — not the minimal fix

The 2026-08-28 human ruling explicitly asked for the STRONGER structural
line ("connect contract to stub so the next widening costs one clear
failure, not twenty-two crashes... a missing deps member must not be
silently defaulted"), not the minimal 15-file patch (which BL-1221 had
already separately delivered as the interim fix). Verified this ticket
delivers the stronger line, not a re-do of BL-1221:

- `helpers/pilotAcceptanceGateDeps.js`'s `baseAcceptanceGateDeps()` is a
  plain, explicit, HAND-maintained object — confirmed by reading it: no
  Proxy, no auto-defaulter, exactly the shape the human's ruling forbids
  circumventing.
- The completeness test
  (`pilotAcceptanceGateDepsCompleteness.test.js`) reads the REAL
  `PilotAcceptanceGateDeps` TypeScript interface source text via a real
  parser (`extractInterfaceBody`/`extractRequiredMembers`, distinguishing
  required `name:` from optional `name?:`, skipping comments) and diffs it
  against the shared stub's own member list
  (`BASE_ACCEPTANCE_GATE_DEPS_MEMBERS`, itself derived from the object,
  never hand-copied a second time).
- **Verified non-vacuous myself**: temporarily deleted
  `checkOrphanedAuthoredDocs` from the shared stub and reran the
  completeness test — it failed with exactly one assertion naming the
  missing member (`missing: ["checkOrphanedAuthoredDocs"]`), then restored
  the file and confirmed `git status` clean. This is the human's own
  "one clear failure naming that member" requirement, proven live, not
  taken on the coder's word.
- **Verified this guard actually reaches the normal lane**: unlike the 25
  sibling `node:test`-importing files BL-1220 covers,
  `pilotAcceptanceGateDepsCompleteness.test.js` uses Vitest's bare global
  `test()` (no `node:test` import) — confirmed it collects and runs under
  `npx vitest run --config vitest.config.mjs` (3/3 pass). A structural
  guard written in a file the normal lane cannot even collect would have
  satisfied the ticket's letter while missing its entire point; this one
  does not have that gap.

## Invariants, both verified directly

1. **No silent defaults**: confirmed by reading `baseAcceptanceGateDeps()`
   — every value is a real, working default (the same benign shape each
   of the 15 files already used), never a value manufactured to paper
   over an absence. The completeness test is what enforces "supply it or
   fail," never the base object silently inventing a member it lacks.
2. **One failure per widening**: proven live above (one assertion, one
   named member, on a real deletion from the shared stub) — independently
   reproduced, not inferred from the coder's evidence.

## Independently re-verified the substance

- Ran all 10 files under Vitest's unit config: 10/10 pass, 98 tests total
  (95 pre-existing + 3 new completeness tests — confirms no assertion was
  dropped, matching qa_e2e item 2's "count went up" requirement).
- Ran the 7 property-lane files under the properties config: 4 pass fully
  (17 tests, including the new `bl1229...Invariants.property.test.js`),
  3 fail to COLLECT with "No test suite found"
  (`bl733ProducerCrosscheck`/`pilotAcceptanceGate.property`/
  `pilotScopedCrapEvidence.property`) — the same 3 files, unrelated
  BL-1220 defect, correctly left untouched and NOT removed from
  `backlog/standing-reds.tsv`/the allowlist (their ownership stays
  BL-1206's), while the 3 property files that DID newly pass
  (`multiBranchParserCoverageCheck`, `perHatRolePromptEvidenceCheck`,
  `unreachableStepHandlerCheck`) had their rows correctly removed —
  verified by reading the diff.
- Production diff is exactly zero
  (`git diff -- extension/src/tools/pilot*.ts` empty); `npm run compile`
  clean.

## Acceptance wiring

Feature declares 5 scenarios / 6 scenario runs (scenario 04 is a 2-example
Outline). Independently drove
`bl1229PilotGateDepsContractStubsSteps.js::registerSteps` against all 6 —
each drives the real compiled `landPilotedTicket` and the shared stub
helper, never a reimplementation — all passed, including scenario 03's
own "missing member fails, no land verdict reported" and scenario 05's
"contract stays required, call site stays unguarded."

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. This closes the class BL-1221
deliberately left open (its own approval_context named this exact ticket
as the structural follow-up). Forwarding to hardener.
