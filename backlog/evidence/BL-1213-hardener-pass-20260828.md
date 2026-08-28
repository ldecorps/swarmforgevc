# BL-1213 hardener pass — 2026-08-28

## Reviewed commit

Merged architect's `61493f9df2` (bare forward, no dedicated evidence file
of its own — cleaner's `85e61c012c` evidence covers the coder delivery and
cleaner's own dedup review) clean into hardender, resolving two trivial
conflicts (`BL-428.json` topic messages, `specs/pipeline/steps/index.js`
requires — both already-converged duplicates from earlier merges this
session, deduped).

## Verification (re-run directly)

- `npm run compile` — clean.
- `bb .../parcel_rollback_guard_lib_test_runner.bb` — ALL PASS.
- `bb .../bl1213_parcel_rollback_guard_property_runner.bb` — 2000 runs,
  ALL PROPERTIES HOLD.
- `node specs/pipeline/cli.js specs/features/BL-1213-...feature` — 8/8
  scenarios pass against the real `swarm_handoff.bb` and
  `parcel_rollback_guard_lib.bb` call chain, real git fixtures, no mocking.
- BL-113 Gherkin mutation (soft) on the one `Scenario Outline:` (4
  examples) — 12/12 mutants killed, 0 survived, manifest embedded in the
  feature file.
- `test/residentPaneLive.test.js` / `test/residentPaneSpy.test.js` — 43
  tests green (touched only by the merge-conflict resolution carried
  forward from earlier merges, not by this ticket's own diff).

## Defect found and fixed: unconditional fixture-directory leak

`specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js`'s own `mkTmp`
helper called `fs.mkdtempSync(path.join(os.tmpdir(), prefix))` directly,
with **no cleanup anywhere in the file** — no `rmSync`, no `finally`, no
`process.on('exit')` registration, unlike every sibling step file in this
directory (`bl1198RematchPushFirstSteps.js`, `bl1189...Steps.js`, etc.)
that either calls `mkSocketFixtureRoot` or wires its own `finally`.

Confirmed empirically before fixing: `ls /tmp | grep -c bl1213` showed
**180+ stragglers** already accumulated on this host from prior runs (this
session's own repeated acceptance/mutation runs against this feature), and
running the acceptance suite once more added 9 more (8 scenarios + 1
extra from the Background's own fixture-per-scenario shape) — every single
run leaks, not just a throw-before-cleanup edge case.

Fixed by switching `mkTmp` to `mkSocketFixtureRoot`
(`specs/pipeline/steps/lib/socketFixtureRoot.js`, BL-948) — the repo's
general fixture-root convention, not socket-specific despite the name (its
own docstring: "an adopter's own afterEach cleanup stays welcome... this
hook is the backstop"). No further code needed: the helper's
`process.on('exit', removeStragglers)` backstop removes every tracked root
automatically, covering both the throw-before-cleanup case (this file's
own Given steps run several git commands with no local try/catch) and the
ordinary run-to-completion case this file was leaking on every single time.

Verified the fix: `rm -rf /tmp/bl1213-parcel-rollback-*` to clear the
backlog, then re-ran the acceptance suite (`node specs/pipeline/cli.js
specs/features/BL-1213-...feature`) — 8/8 still pass, and
`ls /tmp | grep -c bl1213` reads `0` immediately after (previously 180+
before any cleanup).

## Disposition

Hardened. Real, measured fixture-leak defect found and fixed with the
project's own established backstop mechanism — zero behavior change to
the tests themselves, full acceptance/unit/property/mutation coverage
re-verified green. Forwarding to documenter.

By hardender.
