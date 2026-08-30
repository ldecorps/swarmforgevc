# BL-1240 — architect pass (second round), 2026-08-30

Reviewed the cleaner-forwarded commit `a716330d9c` (coder `f8076c531`, cleaner
merge with no additional cleanup) — the rework of my own D1 bounce
(`backlog/evidence/BL-1240-architect-bounce-20260830.md`).

## Verdict: COMPLIANT — forwarded to hardender

## D1 re-verification

Independently reproduced all three previously-broken entry points myself
(not trusting the evidence file's table):

```
cd extension && node -e '... copyScriptClosure(live, tmp, [entry]) ...'
test/cursor_seat_guard_lib_test_runner.bb            => cursor_seat_guard_lib.bb present
test/bl1081_acp_snapshot_agreement_test_runner.bb    => acp_session_lib.bb, prompt_engine_lib.bb present
test/bl1088_giveup_cooldown_property_runner.bb       => front_desk_supervisor_lib.bb present
```

All three now resolve correctly. Also rebuilt a fixture for `swarm_handoff.bb`
itself and ran it — loads cleanly (prints usage on a bad arg, not a
symbol/file-not-found crash).

Read `resolveDepPath`'s new logic directly: the `SCRIPTS_ROOT_ANCHOR` regex
correctly anchors any dep containing `swarmforge/scripts/` at the scripts
root rather than joining it under the referrer's directory, and the new
bare-name resolution (checks referrer-relative existence first, falls back to
flat/root) matches the two live bare-name cases in the tree
(`test/suite_inventory_cli.bb` → sibling, `test/acp_session_lib_test_runner.bb`
→ root). The exhaustive test added
(`extension/test/pinnedRepoFixture.test.js`, "no load-file target in the live
tree is resolved to the wrong anchor") replaces the coder's original grep-based
blast-radius claim with an actual walk of every `.bb` file in the live tree —
this is the right fix for the ROOT problem my bounce identified (an
unverified blast-radius claim), not just the specific instance.

## Independent re-runs

- `cd extension && npx vitest run test/pinnedRepoFixture.test.js` → 16/16
  pass (12 pre-existing + 4 new).
- `npx vitest run test/telegramFrontDeskBotCli.test.js test/commitIntegrityRunner.test.js`
  → 281/281 pass.
- `npx vitest run --config vitest.properties.config.mjs
  test/telegramFrontDeskBotCli.property.test.js test/bl1038PinnedFixture.property.test.js`
  → 5/5 pass.
- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` →
  ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1240's feature → 4/4.

## Dependency-rule gate (BL-259, hard gate)

Full-repo scan: `cd extension && node out/tools/dependency-gate.js` →
`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

Same expected fan-out as the first pass on this file (BL-1038's own commit
plus its many existing consumers) — no new coupling.

## Required wiring

`specs/pipeline/steps/index.js::bl1240UnregisteredTestFailsAuthorSteps` —
still registered (`index.js:887`). `swarm_handoff.bb` still carries the
gate's wiring (`grep -c unregistered_test_gate_lib` → 2), and
`task_scope_gate_lib.bb` still carries `parcel-own-changed-paths` — both
verified intact through this session's merge chain (see the BL-1272 architect
pass evidence for the merge-up restoration this depended on).

## Whitespace-prose exclusion, checked for overreach

`loadFileDeps` now skips a quoted `.bb`-ending value containing whitespace.
Confirmed this is real and necessary, not speculative: read
`swarmforge/scripts/test/bounded_run_lib_test_runner.bb` lines 96/98 directly
— `assert-true` messages reading `"babysitter_check.bb load-files
bounded_run_lib.bb"`, which do contain the literal substring `load-file`
(inside "load-file**s**") and would otherwise have been misparsed as two
extra dependency names. No legitimate filename in this tree contains
whitespace, so the exclusion has no false-negative risk against real
dependencies.

## Merge note

This merge (`a716330d9c` into `b7093f691`) also deleted
`specs/features/BL-1259-expedite-missing-verdict-recovery.feature` — verified
as a deliberate, already-landed retirement (commit `f69160925` on the
coder's branch: BL-1259 retired as a duplicate BL-1254 stamp-off, its
distinct scenario absorbed into BL-1254's own feature file) before completing
the merge commit, per the tree-collapse guard's own request to confirm
rather than blindly override.
