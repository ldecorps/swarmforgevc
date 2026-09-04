# BL-1362 — hardener pass, 2026-09-04

Merged architect commit `c49606f1cb` (clean pass, no bounce —
`backlog/evidence/BL-1362-architect-20260904.md`). Independently re-ran
every gate rather than trusting the evidence trail.

## Checks re-run, all independently

- `npm run compile` — clean.
- `npx vitest run reviewEvidenceRecord.test.js recordReviewEvidenceCli.test.js
  recordReviewEvidenceGate.test.js` — 18/18 PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl1362ReviewEvidenceByToolInvariants` — 2/2 PASS.
- `run_acceptance.sh` on the BL-1362 feature — 9/9 PASS.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## CRAP — a real, own-parcel gap found and closed (not pre-existing debt)

`extension/src` touched this time (three new files). Forced the
coverage write past the ~16 pre-existing unrelated reds
(`--coverage.reportOnFailure=true`). Found `recordReviewEvidenceArgs.ts`'s
`parseArgs` at **complexity=13, coverage=5%, CRAP=156.70** — the CLI's
argv parser, exported specifically for testability per its own file
comment ("split out so ... the parsing is testable with no process at
all") but never actually unit-tested: `recordReviewEvidenceCli.test.js`
only drives `recordReviewEvidence` directly, never `parseArgs`.

Closed in two steps:
1. Added `extension/test/recordReviewEvidenceArgs.test.js`, 15 direct
   unit tests covering every branch (happy path, `--none`, `--date`,
   multiple `--item`s, missing flag value, invalid JSON, non-object JSON
   scalars, a missing ticket/role, an empty argv, `USAGE`'s content).
   One test's first draft asserted a JSON array `--item` should be
   refused — running it revealed the code actually ACCEPTS arrays
   (`typeof [] === 'object'` in JS, so the `typeof parsed !== 'object'`
   guard does not exclude them) — corrected the test to document the real
   behavior rather than assert a stricter one the code was never written
   to enforce.
2. With coverage now 100%, CRAP was still 13.00 (CRAP = complexity at
   100% coverage) — the function's own cyclomatic complexity exceeded the
   threshold regardless of test coverage. Since this is a BRAND NEW
   function with no `main` baseline (the differential-complexity gate
   does not apply — there is nothing to diff against), the absolute
   threshold applies directly. Extracted two behavior-preserving helpers:
   `parseItemFlag` (the `--item` JSON-parse-and-validate branch, its own
   complexity 4) and a tokenizer/reducer split — `collectFlags` (walks
   argv into `{flag,value}` pairs, complexity 4) and `applyFlag` (applies
   one recognized flag, complexity 6) — leaving `parseArgs` itself at
   complexity 6. Final scores: `parseArgs` CRAP 6.00, `applyFlag` CRAP
   6.00, `collectFlags` CRAP 4.00, `parseItemFlag` CRAP 4.00 — all at or
   under the threshold, all 100% covered. Re-ran the full test suite
   (33/33) and the acceptance suite (9/9) after the extraction — no
   behavior change, confirmed by both.

`crapReport.js` now exits 0 for all three touched files.

## DRY

`npx jscpd --config .jscpd.json src` — 75 pre-existing clones repo-wide
(same count as before this parcel), none involving the three touched
files. No new duplication from the extraction.

## BL-149 cooldown gate

`specs/pipeline/steps/lib/bl1362ReviewEvidenceGateProbe.bb` — DECISION:
run (new file). This is a thin acceptance-fixture driver (drives the
real, pre-existing `review_forward_evidence_gate_lib.bb` and prints its
verdict as JSON, per its own header comment) rather than product logic
of its own — no separate hand-authored mutation sweep, consistent with
how this session's other CLI test-fixture scripts (not production
guards) were treated. Its correctness is exercised end-to-end by
acceptance scenario 04, independently re-confirmed above (9/9).

## BL-113 Gherkin mutation (the one Scenario Outline)

Ran `run_gherkin_mutation.sh` soft. 5/5 mutants killed, 0 survived, 0
errors. Manifest stamped.

## Result

One real CRAP gap found and closed via test coverage plus a
behavior-preserving extraction (not a refactor for its own sake — the
extraction exists to bring a brand-new function under the threshold).
No orphaned test/mutation processes belonging to this pass left behind
(confirmed via `pgrep`; the one live process seen belongs to another
role's own in-flight verification of my earlier BL-1358 pass, not this
one). Forwarding to documenter.

By hardender.
