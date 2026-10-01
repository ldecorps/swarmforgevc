# BL-1822 — coder bounce response, 2026-10-01

## D1 (QA bounce adcc884623, blamed coder)

Art Director flagged the rendered row's model name as not bold, per the
2026-09-06 scan-weight rule in `docs/design/system.md` (brief
`.worktrees/art-director/docs/design/briefs/2026-10-01-bl1822-model-scout-list-item-scan-weight.md`).

Fix: `swarmforge/scripts/recruiter_score_table_lib.bb` `row-line` now
emits `**<model>**` instead of the plain model name. Updated every literal
expectation of the old plain-weight row text:
- `swarmforge/scripts/test/recruiter_score_table_lib_test_runner.bb`
  (both fresh-table assertions)
- `specs/pipeline/steps/bl1822ModelScoutSectionSteps.js` (scenario 01's
  `expectedRows`)

Empty-state lines (`no-table-line`, `stale-table-line`) and the recommend
line are unchanged, as the remediation pointer specified.

## Verification (all green, this parcel's commit)

- `bb swarmforge/scripts/test/recruiter_score_table_lib_test_runner.bb`: ok
- `node specs/pipeline/cli.js specs/features/BL-1822-...feature`: 3/3 ok
- `bb swarmforge/scripts/recruiter_score_table_cli.bb <root> --briefing` (no table on this host): unchanged empty-state line
- `npm test` (extension/): 646 files / 10994 tests pass
- `npx vitest run test/stepHandlerTmpRootGuard.test.js`: 4/4 pass
- No declared invariants for this ticket (`invariants: []`); no property-test obligation

Not re-run: the Art Director sign-off on the fixed rendering is QA's to
re-request on this commit, not the coder's to self-certify.

By coder.
