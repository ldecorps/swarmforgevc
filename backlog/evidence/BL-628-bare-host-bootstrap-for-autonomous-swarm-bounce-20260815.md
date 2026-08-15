# BL-628 QA bounce — 2026-08-15

## D1 — documenter's runbook deliverable missing from the forwarded commit

**Failing command:**
```
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature
```

**Commit tested:** `f1329da157` (the commit named in the documenter's `git_handoff` to QA;
`merge_and_process documenter f1329da157`)

**First error excerpt:**
```
# Subtest: the runbook says where the onboarding ceremony happens
not ok 16 - the runbook says where the onboarding ceremony happens
  ---
  duration_ms: 1.031705
  type: 'test'
  location: '.../specs/pipeline/generated/one-documented-path-takes-a-bare-linux-box-to-an-autonomous-swarm.generated.test.js:55:1'
  failureType: 'testCodeFailure'
  error: `Scenario "the runbook says where the onboarding ceremony happens" failed at step
  "When the autonomous bring-up runbook is read": expected the autonomous bring-up runbook
  at docs/how-to/BL-628-autonomous-swarm-bringup.md - not yet written (documenter's pass,
  per this ticket's own required_stages)`
...
1..16
# tests 16
# pass 15
# fail 1
```

**Failure class:** `acceptance`

**Expected vs observed:** BL-628's `required_stages` explicitly lists `documenter`, and the
ticket's own comment states acceptance item 6 ("runbook states the where") IS the
documenter's deliverable (scenario `autonomous-bootstrap-08`). Expected:
`docs/how-to/BL-628-autonomous-swarm-bringup.md` present at the commit QA verifies, so all
16/16 scenarios pass. Observed: the file does not exist at commit `f1329da157` — 15/16 pass,
scenario 08 fails outright with the step handler's own "not yet written" message.

**Blamed role:** documenter

**Remediation pointer:** `specs/pipeline/steps/bl628AutonomousHostBootstrapSteps.js:390-410`
(the `autonomous-bootstrap-08` step handlers) name the missing file exactly:
`docs/how-to/BL-628-autonomous-swarm-bringup.md`.

**Note for the documenter (not a defect in the runbook's content — the work already exists):**
The runbook was in fact written — commit `e31af5a51` ("BL-628: write the autonomous bring-up
runbook") sits on `swarmforge-documenter`, three commits past the one QA was handed
(`f1329da157` → `7fa2a08c5` BL-689 docs → `e31af5a51` BL-628 runbook). Its own commit message
states "full suite now 16/16." None of that later work was included in the `git_handoff` QA
received — the handoff's `commit:` field named the intermediate `f1329da157` rather than the
branch tip. QA cannot adopt `e31af5a51` unmerged into its own worktree by fishing it off
another branch (lineage must come through a proper handoff), so this bounces back for the
documenter to forward its own already-completed tip commit.

## Inventory summary

- Items: D1 (above). Blocked: 0 — every other check ran to completion.
- BL-697 and BL-689 (bundled in the same commit chain, Article 2.6) have **no failing check
  of their own** — full unit, property, acceptance, and required_wiring passes below. Per
  BL-532, these are DEFERRED pending this blocker, not bounced.

## Full verification record (this pass)

- Compile: clean (`npm run compile`).
- Unit suite: 7628/7630 passed; 2 failures (`mermaidRender.test.js`,
  `renderBriefingDiagramsCli.test.js`) reproduced as load-induced timeouts — both files
  re-run in isolation with a 90s timeout and passed cleanly (12.0s / 27.6s actual). Neither
  file was touched by this merge (`git diff f1329da157~40 f1329da157` empty for both).
  Host load average at run time: 44.71/41.05/34.93 — consistent with the known
  Stryker-dry-run-timeout-under-load pattern, not a regression.
- Property tests (`npm run test:properties`): BL-697/BL-689/BL-628's own invariant files —
  17/17 passed in isolation. (The full properties run separately surfaced 2 unrelated
  failures in `bl796NvmNodePathFollowUpAdoptInvariants.property.test.js` and one other file —
  neither touched by this merge, out of scope for this parcel.)
- Acceptance:
  - `specs/features/BL-697-lets-talk-hands-free-listening.feature` — 6/6 pass.
  - `specs/features/BL-689-bounce-carries-its-defect-inventory.feature` — 10/10 pass.
  - `specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature` — 15/16 pass
    (scenario 08 above).
- Shell suites (BL-628): `test_generate_autonomous_conf.sh`, `test_host_bootstrap.sh`,
  `test_provision_autonomous_host.sh`, `test_autonomous_swarm_pack.sh` — all ALL PASS.
- required_wiring (BL-689): `extension/src/tools/qa-bounce-line.ts::defectsPerBounce` —
  confirmed called from `main()` with a real `computeDefectsPerBounce(records)` argument, not
  dead code.
- BL-697 invariants (toggle wiring, localStorage-only persistence, no duplex route added) —
  confirmed directly in `letsTalkUiHtml.ts`/`letsTalkRoutes.ts` and covered by the property
  test.
