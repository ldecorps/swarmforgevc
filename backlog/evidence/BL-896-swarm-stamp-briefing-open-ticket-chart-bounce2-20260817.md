# BL-896 — architect bounce (round 2) — 2026-08-17

## Scope reviewed

Bounce-fix commit `f5d3885c61fc74bd3949bc6eb65467ab02f9451b` (coder), sent by
cleaner via `merge_and_process cleaner b2680ee752`. This is the fix for QA's
2026-08-17 bounce D1 (heading dropped "burndown", contradicting the ticket's
own recorded 2026-08-16 08:20 CEST human ruling).

## Complete review inventory (Article 4.4 — one bounce, everything run)

- Dependency-rule gate (BL-259, hard gate):
  `node extension/out/tools/dependency-gate.js src/metrics/notDoneBurndownChart.ts
  ../specs/pipeline/steps/bl896BriefingOpenTicketChartSteps.js` — PASSED, no
  forbidden edges.
- Co-change coupling (BL-255): all "SUSPECTED COUPLING" flags stay within
  this ticket's own coherent slice (`notDoneBurndown.ts` <->
  `notDoneBurndownChart.ts` <-> `render-briefing-burndown.ts` <-> their own
  test files; `briefing_email_lib.bb` <-> `handoffd.bb` <->
  `briefing_email_test_runner.bb` pre-existing hub), same pattern the prior
  architect pass already found benign. No new/unexpected coupling.
- Unit: `npx vitest run test/notDoneBurndown.test.js test/gitHistoryAdapter.test.js
  test/renderBriefingBurndownCli.test.js test/deliveryMetrics.test.js` —
  67/67 PASS (required a local `npm run compile` first; this worktree's
  gitignored `extension/out/` was stale from before the merge and initially
  showed a false failure on the "burndown" assertion — not a coder defect,
  confirmed by rebuilding).
- Properties: `npm run test:properties -- test/bl896BriefingOpenCountInvariants.property.test.js`
  — 2/2 PASS. `bb swarmforge/scripts/test/bl896_briefing_diagram_source_independence_property_runner.bb`
  — 500 runs, ALL PASS.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS,
  including the updated `burndown-diagram-01` assertions, which now
  correctly assert "burndown" IS present (positive assertion, not just
  absence-of-rejection).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-896-briefing-not-done-burndown-stamp.feature` — 7/7 PASS.
- Invariants (BL-654): both declared invariants still carry the same
  non-vacuous property tests reviewed in the prior architect pass; this
  commit does not touch F3/F4 logic, only heading text and its assertions.
  No re-verification needed beyond the property-test reruns above.
- required_wiring (`handoffd.bb::briefing-burndown-json`): unchanged by this
  commit; already confirmed present in the prior architect pass.

All of the above: PASS. One item fails.

## D1 (behavior defect, coder-owned) — the acceptance gate still doesn't test the ruling it was told to test

1. **Failing command (empirical, not hypothetical):** with
   `src/metrics/notDoneBurndownChart.ts:96`'s heading text reverted to the
   pre-ruling "Open tickets remaining — last N days" (i.e. re-introducing
   exactly the F1 rename QA's first bounce identified), rebuild
   (`npm run compile`) and re-run
   `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-896-briefing-not-done-burndown-stamp.feature`
   — **still 7/7 PASS.** Reverted and rebuilt back to the committed state
   after confirming (`git status --short` clean, `git diff` empty).
2. **Commit hash:** `f5d3885c61` (coder's bounce-fix; the gap is an
   incomplete remediation of QA's own 2026-08-17 bounce, item D1).
3. **First error excerpt (the gap, not a stack trace):**
   - QA's remediation explicitly said: *"Update
     `specs/features/BL-896-briefing-not-done-burndown-stamp.feature`
     scenario 01 (and its step handler) to assert the ruling's actual
     requirement instead of the superseded F1 rename, so the acceptance
     gate stops passing a heading it should reject."*
   - The commit fixed the step that WAS mis-encoding the F1 rename as a
     rejection rule (`it makes no claim of progress...` no longer rejects
     the bare word "burndown" — correct, and necessary).
   - But no step in this feature was ever changed to *require* "burndown"
     appear. `its heading names the series as remaining open tickets over
     the window` (`bl896BriefingOpenTicketChartSteps.js:92-95`) only checks
     `/Open tickets remaining/i` — a substring present in both the correct
     heading and the wrong (reverted) one — so it cannot detect the
     regression QA's bounce was about.
   - By contrast, the unit test (`extension/test/notDoneBurndown.test.js`)
     and the Babashka suite (`briefing_email_test_runner.bb`'s
     `burndown-diagram-01`) were both correctly updated with a positive
     `/burndown/i` assertion. Only the acceptance/Gherkin layer — the one
     QA's remediation specifically named — was left without one.
4. **Failure class:** `behavior` (the acceptance gate, which QA's own
   remediation instruction named as the thing to fix, does not encode the
   controlling requirement and would silently accept a regression of the
   exact defect this ticket was bounced for).
5. **Expected vs observed:** Expected — scenario 01 (or its step handler)
   asserts the heading contains "burndown", so a future regression back to
   the F1 rename fails acceptance. Observed — the acceptance suite passes
   either heading; only the unit and Babashka suites would catch a
   regression.

## Remediation (coder)

- Add a positive assertion that the heading contains "burndown" to
  `bl896BriefingOpenTicketChartSteps.js`'s `its heading names the series as
  remaining open tickets over the window` step (or a new step covering the
  ruling explicitly) so the acceptance gate — not only the unit/bb suites —
  fails if the word is ever dropped again. The Gherkin prose in the
  `.feature` file may need updating too if the current line ("Then its
  heading names the series as remaining open tickets over the window")
  should also name the "burndown" requirement explicitly — coder's call
  within that constraint, mirroring how the prior bounce left the exact
  wording choice to the coder.
- Re-run the acceptance suite after the fix, and re-verify with the same
  revert-and-check method used above (temporarily drop "burndown" from the
  heading, confirm acceptance now FAILS, then restore) as the break-then-fix
  proof, matching this project's non-vacuous-test discipline elsewhere.

By architect.
