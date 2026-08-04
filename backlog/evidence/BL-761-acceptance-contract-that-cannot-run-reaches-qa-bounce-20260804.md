# BL-761 QA bounce — 20260804

Commit tested: `3ed175383bb42e536cb6ae8194b88413756d7dda` (documenter, forwarded to QA).

## Review inventory (Article 4.4 — complete pass, one item survives)

Checks run this pass, in order:

1. `npm run compile` (extension) — clean.
2. Full unit suite (`npm test`, extension) — 7079/7082 passed, 3 failed across 2
   files, plus 164 `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled
   errors. Host `uptime` showed load average 50.20 (vs the box's core count —
   severe-load territory per the standing Stryker-under-load lesson). Both
   failing files were re-run in isolation:
   - `test/renderBriefingDiagramsCli.test.js` (2 failures, generic
     `STACK_TRACE_ERROR`, no BL-761 relation, untouched by this parcel) —
     **4/4 pass in isolation**. Confirmed load-induced flake, not a defect.
   - `test/tmpDirMigrationGuard.test.js` (1 failure) — **fails again in
     isolation, deterministically.** This is D1 below.
3. Property suite (`npm run test:properties`) — first full run: 138/142
   passed, 4 failed across 2 files (`test/bl787NamedTunnelInvariants.property.test.js`
   and one other), plus 3 more `vitest-worker` timeout errors under the same
   load. Isolated re-run of `test/acceptanceContractGate.property.test.js`
   (BL-761's own invariant test) together with `bl787NamedTunnelInvariants` —
   **6/6 pass**. `bl787...` is a pre-existing file from ticket BL-787
   (commit `eaa2b53b`), never touched by this parcel — confirmed load-induced
   flake, not a defect, not in scope here.
4. Acceptance pipeline for the ticket's own feature file
   (`specs/features/BL-761-acceptance-contract-must-be-runnable.feature`) —
   **13/13 scenarios pass** (`run_acceptance.sh`).
5. `bb swarmforge/scripts/test/acceptance_contract_gate_lib_test_runner.bb` —
   ALL PASS.
6. `bb swarmforge/scripts/test/pre_qa_gate_gather_lib_acceptance_contract_test_runner.bb`
   — ALL PASS.
7. `required_wiring` (`swarmforge/scripts/pre_qa_gate_gather_lib.bb::acceptance-contract`)
   — confirmed a real call site: `gather-acceptance-contract-facts` +
   `acceptance-contract-gate-lib/evaluate` are invoked from
   `gather-pre-qa-gate-facts` and their findings/warnings are concatenated
   into the returned result (not orphaned; not merely defined).
8. Docs currency — documenter's own commit (`3ed17538`) added "Check D —
   Acceptance Contract Cannot Run" to `swarmforge/handoff-protocol.md`, an
   "Acceptance-Contract Refusals" section to
   `docs/how-to/BL-531-handoff-refusal-remedies.md`, and a
   `Specification.MD` changelog entry. Read in full — accurate, matches the
   shipped behavior.
9. Ticket's own e2e procedure (description, steps 1-6) — step 1 (feature
   file green) done via #4 above; steps 2-5 (refuse/forward fixture
   behavior, cross-role scope) are exercised by the feature file's own
   scenarios 01/03/05/06; step 6 (regression against a real BL-707-shaped
   commit) has no dedicated scenario, but scenario 04 ("the contract is
   judged at the cited commit, not in the sender's working tree") exercises
   the identical cited-commit step-resolution mechanism the manual check
   targets — treated as equivalent coverage, not a gap.

No check was BLOCKED — every gate QA owns ran to completion.

## D1 — raw `mkdtemp` call site outside the shared test helper

- **Class**: `unit`
- **Blamed role**: `coder` — introduced in `a5d8039e` ("BL-761: gate a
  parcel from reaching QA when its acceptance contract cannot run"), the
  file's only commit (`git log --follow` confirms no later touch by
  cleaner/architect/hardener/documenter).
- **Failing command**: `npx vitest run test/tmpDirMigrationGuard.test.js`
  (extension/)
- **Commit**: `3ed175383bb42e536cb6ae8194b88413756d7dda`
- **First error excerpt**:
  ```
  AssertionError: expected zero raw mkdtemp call sites, found:
  /Users/ldecorps/projects/swarmforgevc/.worktrees/QA/extension/test/acceptanceContractGate.property.test.js:167

  + [
  +   {
  +     "file": ".../test/acceptanceContractGate.property.test.js",
  +     "line": 167,
  +   },
  + ]
  - []
  ```
- **Remediation pointer**: `extension/test/acceptanceContractGate.property.test.js:167`,
  function `evaluateAllInBb` — calls
  `fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl761-prop-'))` directly
  instead of the shared helper `mkTmpDir` from
  `extension/test/helpers/tmpDir.js` (already used elsewhere in this same
  suite, e.g. `renderBriefingDiagramsCli.test.js`). This is exactly the
  pattern `tmpDirMigrationGuard.test.js` (from BL-420) exists to catch —
  raw call sites bypass the shared helper's guaranteed cleanup.
- **Expected vs observed**: Expected zero raw `mkdtemp` call sites in
  `extension/test/`; observed one, at the line above.

## Disposition

One item, D1, routed to **coder** (earliest/only blamed role) to swap the
raw `fs.mkdtempSync(...)` for `mkTmpDir(...)` from `./helpers/tmpDir` in
`evaluateAllInBb`. Everything else in this parcel — the gate's own behavior,
its wiring, its docs — is verified clean.
