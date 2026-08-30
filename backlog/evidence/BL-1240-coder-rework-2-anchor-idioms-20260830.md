# BL-1240 — coder rework of architect bounce D1, 2026-08-30

Bounce: `backlog/evidence/BL-1240-architect-bounce-20260830.md` (one item, D1).
Fixed at the anchor, not at the symptom. The four idiom-specific test cases the
bounce told me not to touch are untouched; four more were added.

## D1 — FIXED, and the finding generalised

The architect is right and the diagnosis is exact. Two `load-file` idioms look
identical to a segments-before-the-filename rule and mean different anchors:

    (fs/path (fs/parent *file*) "test" "x.bb")          relative to the referrer
    (fs/path repo-root "swarmforge" "scripts" "x.bb")   the scripts root itself

My first rework read the second as the first, producing
`test/swarmforge/scripts/x.bb`, which exists nowhere — so `copyScriptClosure`'s
"named but absent" path silently skipped it, reintroducing exactly the failure
class this ticket closes, for four files
(`bl1081_acp_snapshot_agreement_test_runner.bb` ×2,
`cursor_seat_guard_lib_test_runner.bb`, `bl1088_giveup_cooldown_property_runner.bb`).

`resolveDepPath` now recognises a `swarmforge/scripts/` prefix — anywhere in
the dep, so a path that climbs out with `..` and back in resolves the same way —
and anchors it at the scripts root.

### A THIRD anchor the bounce did not name, found by doing the sweep properly

Building the exhaustive check the bounce asked for surfaced a case neither of
us had: a **bare** dependency name spells no path, so it names no anchor
either, and BOTH readings are live in this tree.

- `test/acp_session_lib_test_runner.bb` load-files `acp_session_lib.bb`, which
  is at the scripts **root** (30+ runners do this).
- `test/suite_inventory_cli.bb` load-files `suite_inventory_lib.bb`, which is
  its **sibling** in `test/` (5 files do this).

The old flat `path.basename` behaviour got the first right by accident and the
second wrong by accident; a purely referrer-relative rule would have inverted
both. `resolveDepPath` now resolves a bare name against the tree, nearest
first — exactly what the `load-file` expression itself does — falling back to
the historical flat reading when it has no reader to ask. The existence
predicate comes from `resolveScriptClosure`'s own injected `readSource`, so no
new IO seam was introduced.

`loadFileDeps` also now ignores a quoted `.bb` value containing whitespace: two
lines in `bounded_run_lib_test_runner.bb` are prose
(`"babysitter_check.bb load-files bounded_run_lib.bb"`) and were being read as
filenames.

## The blast-radius check, done properly this time

My first pass grepped for the shape I had just fixed and concluded it was the
only one. That premise did not generalise, which is the bounce's real finding.

The replacement is a test, not a grep: **walk every `.bb` in the live scripts
tree, resolve every dependency each one names, and fail on any that lands on
the wrong anchor.** The signature is precise — the resolved path is absent but
a file of that basename exists somewhere in the tree — so a name that exists
nowhere at all (a fixture's own `a.bb`) is correctly not a finding, while
`swarmforge/scripts/x.bb` resolved to `test/swarmforge/scripts/x.bb` is. It
also asserts it actually met multi-segment targets, so it cannot pass by
meeting only bare basenames.

That check now fails the moment ANY idiom in the tree is mis-anchored, by any
future change, rather than three days later inside an unrelated ticket's
fixture.

## TDD

Four new cases, all red before and green after
(`extension/test/pinnedRepoFixture.test.js`, now 16 tests):

- the `repo-root "swarmforge" "scripts"` idiom anchors at the scripts root —
  and the other two idioms still mean what they meant
- a scripts-root anchor reached through `..` resolves the same way
- no load-file target in the live tree is resolved to the wrong anchor
- the live closure of a scripts-root-idiom entry point carries its dependency
  (the architect's own repro, as a test)

The four cases from the first rework are unchanged.

## Verification

| Command | Result |
|---|---|
| `npx vitest run test/pinnedRepoFixture.test.js` | 16 pass |
| `npx vitest run test/telegramFrontDeskBotCli.test.js` | 271 pass |
| `npx vitest run --config vitest.properties.config.mjs test/telegramFrontDeskBotCli.property.test.js` | pass |
| `npx vitest run --config vitest.properties.config.mjs test/bl1038PinnedFixture.property.test.js` | pass |
| `npx vitest run test/commitIntegrityRunner.test.js` | 10 pass |
| `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` | ALL PASS |
| `run_acceptance.sh` on BL-1240's feature | 4/4 |

The architect's repro, re-run for all three affected entry points:

    test/cursor_seat_guard_lib_test_runner.bb            -> cursor_seat_guard_lib.bb present
    test/bl1081_acp_snapshot_agreement_test_runner.bb    -> acp_session_lib.bb, prompt_engine_lib.bb present
    test/bl1088_giveup_cooldown_property_runner.bb       -> front_desk_supervisor_lib.bb present

## Note on the merges this rework sits on

Both the QA merge-up (`7b08b2777`) and the architect's bounce commit
(`b92f2d8fa4`) carry a revert of BL-1240's merge into their own branches —
correct on those branches, since a bounced commit must come out of the bouncing
branch. Taking either revert here would have deleted the work each bounce is
asking me to extend. Both merge commits therefore restore BL-1240's files and
its four wiring sites from this branch's tip, and each merge commit says so and
lists what it restored. Verified after both: `git diff` against each merge
shows no remaining BL-1240 removal, the gate is still wired into
`swarm_handoff.bb`, its steps are still registered in `specs/pipeline/steps/index.js`,
its manifest row is still present, and its own suites pass.
