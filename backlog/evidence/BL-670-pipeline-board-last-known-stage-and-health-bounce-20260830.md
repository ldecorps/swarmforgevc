# BL-670 — architect bounce, 2026-08-30

Reviewed commit `ab04342ce` (coder, merged into cleaner as `500ce986d7`,
merged into architect as `b13470722`).

## Review inventory

- **Dependency-rule gate** (`node extension/out/tools/dependency-gate.js
  src/swarm/swarmState.ts src/bridge/pipelineGridLive.ts
  src/tools/telegram-front-desk-bot.ts`): PASSED, no forbidden edges.
- **Co-change report** (`node extension/out/tools/co-change-report.js
  src/swarm/swarmState.ts specs/pipeline/steps/bl670PipelineBoardLastKnownStageSteps.js
  swarmforge/scripts/pipeline_stage_lib.bb swarmforge/scripts/pipeline_stage_cli.bb`):
  ordinary, already-expected companions only (test files, index.js,
  pipelineBoard.ts/handoffd.bb family). No action.
- **Two-layer / host-owns-IO / no browser storage / secrets / integrate-not-fork
  boundaries**: unaffected — this parcel is pure derivation logic on both sides
  of the language boundary, no webview/UI/tmux-spawn changes.
- **Declared invariants (3)**: all three have property-test coverage —
  invariant 1 in `swarmforge/scripts/test/bl670_stage_qualifier_property_runner.bb`
  (bb lane, non-vacuity shown in the evidence file by breaking `displaces?`),
  invariants 2 and 3 in `extension/test/bl670StageQualifierInvariants.property.test.js`
  (reach-floor checked, non-vacuous). Ran `bb
  swarmforge/scripts/test/pipeline_stage_qualifier_test_runner.bb` (ALL PASS),
  `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` (ALL CHECKS PASSED),
  and `npx vitest run --config vitest.properties.config.mjs
  test/bl670StageQualifierInvariants.property.test.js
  test/bl1048DeliveredParcelIsNotNotStarted.property.test.js
  test/bl1188PipelineGridLiveStageParityInvariants.property.test.js` (7/7 green)
  — no violation.
- **required_wiring**: all four anchors present and non-vacuous —
  `pipeline_stage_cli.bb`'s `scanned-mailbox-states` now includes `:sent`,
  `pipeline_stage_lib.bb` defines `in-transit-status`, `swarmState.ts` defines
  `TICKET_STAGE_STATUS_LAST_KNOWN` / `TicketStageEntry`, and
  `specs/pipeline/steps/index.js` registers `bl670PipelineBoardLastKnownStageSteps`.
- **Mirrored-constant rule (BL-897)**: satisfied —
  `extension/test/bl670TicketStageQualifier.test.js`'s
  "the status and dot literals agree across the language boundary" describe
  block reads the six literals out of `pipeline_stage_lib.bb` by regex and
  asserts them equal to the TS exports.
- **Correctness read**: D1 below.

## D1 — a landed BL-464 regression test still asserts the OLD bare-role
return shape of `readTicketStageMap` (correctness send-back, own parcel)

`readTicketStageMap` (`extension/src/swarm/swarmState.ts`) changed its
return contract from `Record<string, string>` to
`Record<string, TicketStageEntry>` (normalising every value through
`normaliseTicketStageEntry`). Every other caller and every other test in
this parcel was updated for the new shape (`test_pipeline_stage_cli.sh`'s
`{"stage":...}` matchers, the new `bl670*.test.js`/`.property.test.js`
files, `invertTicketStageToRoleHeldTickets`'s dual-shape acceptance) — but
the pre-existing standing test
`extension/test/state.test.js:335-341` ("BL-464: readTicketStageMap reads
the coordinator-persisted {ticketId: role} store") still asserts the bare
string:

```js
fs.writeFileSync(path.join(dir, 'ticket-stage-map.json'), JSON.stringify({ 'BL-434': 'coder', 'BL-450': 'specifier' }));
assert.deepEqual(readTicketStageMap(tmp), { 'BL-434': 'coder', 'BL-450': 'specifier' });
```

Reproduced: `cd extension && npx vitest run test/state.test.js --config
vitest.config.mjs` → 1 failed, 27 passed. `readTicketStageMap` now returns
`{ 'BL-434': { stage: 'coder', status: 'last-known' }, 'BL-450': { stage:
'specifier', status: 'last-known' } }` for that fixture, which is in fact
the CORRECT new behaviour (a bare-role entry has no observed status, so it
is honestly reported `last-known` per the parcel's own design) — the test
itself is simply stale, not the production code. This is deterministic, not
flaky: the assertion is a plain object-shape mismatch, reproduces on every
run.

The other two tests in that same `readTicketStageMap` block (missing-file,
corrupt-file → both expect `{}`) and both `invertTicketStageToRoleHeldTickets`
tests below it are unaffected and still pass, since `invertTicketStageToRoleHeldTickets`
still accepts the bare-role shape.

**Remediation**: update `extension/test/state.test.js:335-341` to assert the
new normalised shape (`{ 'BL-434': { stage: 'coder', status: 'last-known' },
'BL-450': { stage: 'specifier', status: 'last-known' } }`, matching the
pattern `bl670TicketStageQualifier.test.js` already uses), or fold the
coverage into the new `bl670TicketStageQualifier.test.js` and delete the now-
redundant BL-464 one — coder's call. No other file needs a matching change;
this is the only standing test asserting the old bare-role return shape of
`readTicketStageMap` (full grep across `test/*.test.js` for
`readTicketStageMap`/`TicketStageEntry` confirms the four other hits are all
already shape-correct).

## Disposition

Architecture, invariants, required_wiring and the mirrored-constant rule all
pass. One correctness defect (D1) found by running the full test suite this
parcel touches — bounced to the coder rather than forwarded to the
hardener.
