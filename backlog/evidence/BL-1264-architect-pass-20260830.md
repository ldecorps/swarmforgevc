# BL-1264 — architect pass, 20260830

Commit reviewed: b585faa623 (cleaner tip), merged into architect at this pass.

## Scope of parcel diff (4c4595baf5..HEAD, this ticket's own work)
- extension/src/metrics/backlogDashboard.ts — `computeNeedsApproval` now
  spreads `approvalContext` conditionally instead of unconditionally.
- extension/test/backlogDashboard.test.js — the pre-existing strict
  `deepEqual` assertion at :136 (unchanged, per the ticket's constraint).
- extension/test/bl1264OptionalKeyAbsenceInvariants.property.test.js (new)
- specs/pipeline/steps/bl1264AbsentApprovalContextSteps.js (new) +
  specs/pipeline/steps/index.js registration
- backlog/evidence/BL-1264-coder-20260830.md

### Bundled non-BL-1264 commits carried in the same coder→cleaner lineage
The merged range also carries two small, self-contained, already-tagged
commits from OTHER tickets: `002d55352` (BL-1225, widens a property
generator's weighting so its reach floor stops flaking) and `4124c185b`
(BL-1210, same fix shape for its own reach floor) — both explicitly
"no property, generator shape or assertion changed," done to stop the
property-suite guard from spuriously refusing an unrelated commit. Neither
touches a BL-1264 file, both are independently tagged and explained in
their own commit messages, and both are verified green below. Not a
BL-1264 concern; noted for the trail per Article 2.6's spirit (the parcel
carries more than one ticket's fingerprints) — surfacing here rather than
silently absorbing them into BL-1264's own record.

## Checks run
1. **Dependency gate**: `node extension/out/tools/dependency-gate.js
   src/metrics/backlogDashboard.ts test/backlogDashboard.test.js
   test/bl1264OptionalKeyAbsenceInvariants.property.test.js` → PASSED, no
   forbidden edges. Pure data-shape function, no VS Code API, no I/O.
2. **Co-change report** on backlogDashboard.ts: top hits are its own test
   file, the PWA (pwa/app.js, pwa/index.html) and generate-backlog-dashboard.ts
   — all expected, standing coupling for this producer/consumer pair, not
   new. Nothing suspicious introduced by this one-line-shape fix.
3. **Invariant review** (ticket declares 1): covered by
   bl1264OptionalKeyAbsenceInvariants.property.test.js's three properties
   (key presence tracks context presence; no key is ever valued `undefined`;
   serialised form is identical). Ran `npm run test:properties -- bl1264`:
   3/3 green.
   - **Non-vacuity re-verified by hand**: reverted the conditional spread to
     the old unconditional one in backlogDashboard.ts, recompiled, and
     re-ran — `backlogDashboard.test.js` dropped to 49/51 (the exact :136
     assertion failing as the ticket predicts) and 2 of 3 property tests
     failed. Restored the file, recompiled, re-ran: 51/51 unit, 3/3
     property, `git status` clean.
4. **Constraints verified directly, not just via evidence file**:
   - deepEqual assertion at backlogDashboard.test.js:136 is unchanged (only
     the producer moved) — confirmed by re-reading the diff.
   - No sentinel (empty string/null) substituted — confirmed by reading the
     fix: the spread is `{}` or `{ approvalContext: item.approvalContext }`,
     nothing else.
   - Top-level `needsApproval`/`notDoneCount` "always present" posture
     untouched — diff touches only the per-entry map body.
   - Serialised artefact unaffected — acceptance scenario 02 and property
     test 3 both assert byte-identical JSON before/after; both green.
5. **Acceptance**: `node specs/pipeline/cli.js
   specs/features/BL-1264-an-absent-approval-context-is-an-absent-key.feature`
   → 4/4 scenarios pass.
6. **Consumer sweep**: ran conciergeTick, pendingApprovalsAnnouncement,
   topicRouter and backlogDashboard suites together directly (not just
   trusting the coder's evidence claim) — 188/188 pass, none of the four
   readers modified.

## Architecture boundary checks
- Pure metrics/data-shape module, no extension-host/webview boundary
  crossed, no I/O added, no browser storage, no secrets. Two-layer and
  integrate-not-fork rules are not implicated by this change.

## Full-repo out-of-parcel failures
None encountered.

## Verdict
COMPLIANT. No architecture violation, no invariant violation, no
correctness defect spotted. Forwarded to hardender.
