# BL-221 QA bounce — 2026-07-10

1. **Failing command**:
   ```
   specs/pipeline/scripts/run_acceptance.sh specs/features/BL-221-stryker-sandbox-missing-pwa-assets.feature
   ```

2. **Commit hash tested**: `29adf40d1f`
   (QA worktree, documenter handoff `daf8b13e07` merged up)

3. **First error excerpt**:
   ```
   TAP version 13
   # Subtest: a test that loads a pwa asset succeeds inside the Stryker sandbox
   not ok 1 - a test that loads a pwa asset succeeds inside the Stryker sandbox
     ---
     error: 'Scenario "a test that loads a pwa asset succeeds inside the Stryker
       sandbox": no step handler matched "Given the repository has a sibling pwa/
       directory at the repo root"'
     code: 'ERR_TEST_FAILURE'
   # Subtest: the mutation gate reaches mutant evaluation instead of aborting
   not ok 2 - the mutation gate reaches mutant evaluation instead of aborting
     error: 'Scenario "the mutation gate reaches mutant evaluation instead of
       aborting": no step handler matched "Given the repository has a sibling
       pwa/ directory at the repo root"'
   1..2
   # pass 0
   # fail 2
   ```
   Both scenarios fail identically: zero step handlers match any Given/When/Then
   line in the feature file. `specs/pipeline/steps/index.js` still registers only
   `backlogSteps.js` (and, as of the BL-203 fix now on this branch,
   `daemonWorkflowSteps.js`) — no mutation/Stryker-sandbox domain module exists.

4. **Failure class**: `acceptance`

5. **Expected vs observed**: Expected `run_acceptance.sh` (QA's mandated final
   gate, `roles/QA.prompt` BL-112) to execute BL-221's two scenarios against
   real step handlers driving the actual sandbox-link mechanism (or a real
   scoped `stryker run` subprocess) and pass/fail on genuine behavior. Observed
   0/2 scenarios have any matching step handler — no step module was added for
   this ticket's vocabulary, same class of gap as BL-203 (bounced and fixed
   earlier this session by adding `specs/pipeline/steps/daemonWorkflowSteps.js`
   and registering it in `index.js`; see that commit for the pattern this
   ticket should follow).

Note on manual verification (not a substitute for the gate, but confirms the
underlying fix is real): I independently ran the actual hardener QA e2e
procedure by hand — `node scripts/ensureStrykerPwaSandbox.js` then
`npx stryker run --mutate 'out/notify/emailContent.js' --concurrency 1` — and
confirmed zero ENOENT anywhere in the log, "Initial test run succeeded. Ran
2048 tests in 41 seconds" (all 5 pwa/*.test.js files plus the new
strykerPwaSandbox.test.js ran clean inside the sandbox), the run reached
mutant evaluation (19 killed / 4 survived, all pre-existing TS-boilerplate
mutants unrelated to this ticket), and the mutated-files table shows only
`emailContent.js` — no pwa/ file entered the mutate set. The underlying
mechanism (`extension/scripts/strykerPwaSandboxLib.js`'s shared
`.stryker-tmp/pwa` symlink) works. This bounce is scoped to the missing
acceptance-pipeline step handlers only; the unit suite (2048/2048) and the
new `strykerPwaSandbox.test.js`/`hardenerTooling.test.js` coverage are green.
