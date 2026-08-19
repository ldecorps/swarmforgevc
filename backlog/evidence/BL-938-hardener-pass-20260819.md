# BL-938 hardener pass — 2026-08-19

## Reviewed commit
`c114a0c311` (architect merge, forwarding two coder commits unchanged by
cleaner — see `backlog/evidence/BL-938-architect-pass-20260819.md`).

## Tooling scope check
No `extension/src/*.ts` file is touched by this parcel (confirmed via
`git diff` — only `swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh`,
the new `specs/pipeline/steps/bl938AgedNoteRotateFixtureRotationRouterSteps.js`,
and a 1-line append to `specs/pipeline/steps/index.js`). Stryker mutation
(scoped to compiled `extension/out/**/*.js`), CRAP (scoped to
`extension/src/*.ts`), and DRY/`jscpd` (`extension/.jscpd.json` pattern
`**/*.ts` under `extension/`) are therefore all inapplicable — none of
this parcel's files fall under any of the three. This matches the
project's own Testability Boundary: bash/Babashka is gated only by its own
suite, no mutation/CRAP/DRY wired. Not fabricating tooling that doesn't
apply.

BL-113 Gherkin mutation: the acceptance feature
(`BL-938-aged-note-rotate-fixture-declares-a-rotation-router.feature`) has
zero `Scenario Outline:` blocks (4 plain `Scenario:`s only) — the BL-638
exemption applies, no examples to mutate. Not run.

## Checks run (complete inventory, not first-failure-stop)

1. **Leftover process/fixture check before starting**: no stray
   `node --test`/`stryker`/leaked fixture tmux sockets in this worktree.
2. **Independently re-ran the fixed shell test 3x** (not just once, to
   probe the flake the coder/architect both flagged in
   `cleanup_a`/`cleanup_b`): `test_handoffd_aged_note_rotate_wiring.sh` —
   3/3 clean runs, exit 0 each time, `PASS: A`/`PASS: B`/`ALL PASS` every
   time, no `Permission denied` cleanup-race artifact recurring across
   repeats (matches the step handler's own documented reasoning for
   asserting on `PASS:`/`FAIL:` lines rather than exit code alone).
3. **Independently re-ran both sibling wiring tests** myself (not just
   trusted from the architect's report):
   `test_handoffd_priority_rotate_wiring.sh` (4/4 PASS) and
   `test_handoffd_starve_rotate_wiring.sh` (4/4 PASS) — confirms no
   collateral effect from BL-938's fixture change.
4. **Independently ran the full acceptance feature end-to-end**
   (`node specs/pipeline/cli.js specs/features/BL-938-....feature`) — 4/4
   scenarios pass, including scenario 03 (non-vacuity, ~41s, genuinely
   waits out the poll window with actionability neutralised) and scenario
   04 (negative case: pack declaration removed, daemon still refuses with
   `not-a-rotation-router`, confirming BL-931's gate is unweakened).
5. **Fixture-leak check after the acceptance run**: `git status --short`
   clean; no `sfvc-bl938-acc-*` directory left under the OS temp dir; no
   `.bl938-acceptance-scratch-*` file left in
   `swarmforge/scripts/test/`. The step-handler's cleanup runs via a
   module-level `node:test` `afterEach` hook (not a terminal-step-only
   cleanup), so it fires regardless of which step in a scenario throws —
   this is the safe shape per the BL-788/BL-921-class cross-step lifetime
   hazard, not the vulnerable one; confirmed by reading the file, not
   assumed.
6. **Daemon-root check** (my own "test fixture rooted under this repo gets
   reaped by the live supervisor" hazard): the step handler's
   `buildChaseSweepFixture` roots under `os.tmpdir()`, not under this repo
   — the live `handoffd_supervisor.bb`'s substring-match reaping does not
   apply here. Confirmed by reading the source, not assumed.
7. **No coverage gap to fill**: this is a wiring/fixture-correctness fix
   with no new pure logic to unit-test (the ticket's own invariants 1/2/3
   are procedural/integration properties, already independently
   re-verified by the architect and re-confirmed by my own repeat runs
   above) — no test to add.

## Outcome
No defects found. No applicable mutation/CRAP/DRY tooling (bash/Babashka
parcel, testability boundary). Independently re-verified the fix's
stability (3 repeat runs of the fixed test), sibling non-regression, and
fixture cleanliness beyond what the architect already checked once.

Forwarding to documenter.

By hardener.
