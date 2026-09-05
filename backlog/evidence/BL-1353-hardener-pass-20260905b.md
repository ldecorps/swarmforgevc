# BL-1353 hardener re-pass — supersede + QA merge-up, still clean

## What changed since the first pass (78c7e62777)
- Merged architect's supersede `1efeb88b0f` (supersedes `f28ebd7c06`): the
  cleaner reconciled a duplicate step registration in
  `bl1353TaskArrivedIsNotAnEscalationSteps.js` between two independent
  fixes for the same specifier amendment, keeping the coder's version
  (adds an `s.hibernated` assertion to the relaunch step) and dropping the
  cleaner's own now-redundant `backlogDrained` field. No `.bb` production
  logic touched.
- Merged QA's BL-1370 merge-up broadcast (`4409993daf`, QA-approved,
  addressed to every worktree role). One conflict:
  `swarmforge/scripts/test/suite-manifest.tsv` — both sides independently
  appended a different new row at the end of the file (mine:
  `test_bl1401_acceptance_fixture_derives_set.sh`, theirs:
  `test_bl1370_worktree_strays.sh`, already present un-conflicted above the
  marker). Resolved by keeping both rows, matching the file's existing
  `name<TAB>standing<TAB><TAB>` column shape exactly (verified with
  `cat -A` against a neighbouring row before resolving).

## Re-verified after both merges
- `bb swarmforge/scripts/test/operator_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/operator_lib_bl653_property_runner.bb` — ALL
  PASSED.
- Acceptance (`BL-1353-...feature`): **4/4** pass (now including the new
  `s.hibernated` assertion from the reconciled step file).
- Property (`bl1353TaskArrivedIsNotAnEscalation.property.test.js`): **3/3**
  pass.

## suite-manifest.tsv gate
`bb swarmforge/scripts/test/suite_inventory_cli.bb` reports 2 problems
(`handoffd_supervisor_startup_grace_test_runner.bb`,
`test_handoffd_outbox_vanished_parcel_wiring.sh` unregistered) — confirmed
**pre-existing**, from the unrelated BL-1342 hotfix commit `27d6ab8630`
(`backlog/done/M8/BL-1342-...yaml`), absent from the manifest at both
`f28ebd7c06` and this branch's prior `HEAD` before either merge. Not
introduced by my conflict resolution, not this ticket's or BL-1370's
diff — out of scope.

## Forwarding
Supersedes the prior BL-1353 forward at `78c7e62777`. To documenter,
priority `00`, same task name, this commit (`80b6a4ab38`) forwarded in
its place.
