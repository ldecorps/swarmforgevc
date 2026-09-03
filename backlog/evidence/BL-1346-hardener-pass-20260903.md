# BL-1346 hardener pass — 2026-09-03

Merged architect commit `e09d781495` (clean sweep, no defect) onto this
worktree (one trivial additive `require(...)`-list conflict in
`specs/pipeline/steps/index.js`, same shape as this session's other
merges).

This is a BL-848 review-only stamp-off of already-landed commit
`195de28861`, same family as this session's BL-1333/BL-1342. Confirmed
`backlog/hotfix-ledger.yaml`'s `195de28861` row is still `state:
stamp-open` — untouched.

## required_wiring re-confirmed live
`swarm_ensure.bb::resolve-resident-role` (2), `swarm_ensure.bb::rc-launch-role`
(3), `bl1346SwarmStampRcLaunchRoleSteps` registered — matches the
architect's counts.

## Real defect found and fixed: the same socket-fixture-root guard violation, third occurrence this session
`specs/pipeline/steps/lib/bl1346RcRepairStampFixture.js` was flagged by
`socketFixtureShortRootGuard.test.js` — the identical class as BL-1333
and BL-1342 earlier this session: `makeFixture()` built its root under
`os.tmpdir()` and wrote a real `.swarmforge/tmux-socket` pointer file.
This is the third BL-848 stamp-off ticket in a row with this exact gap,
missed again by coder/cleaner/architect (the specifier declined my
rule_proposal after BL-1342 on the grounds that the standing guard
already exists and is tracked as BL-1290 — that gate is what caught this
one too, working as intended, just late in the pipeline).

Fix: identical to the BL-1333/BL-1342 remedy — `mkroot` switched to
`mkSocketFixtureRoot`, `sweepStaleFixtures()` switched to the short
base, `removeFixture()` calls `releaseSocketFixtureRoot`. Removed the
unused `os` import.

Re-verified after the fix:
- `npx vitest run test/socketFixtureShortRootGuard.test.js` — the file
  no longer appears; only the 2 pre-existing BL-1290 violations remain.
- `node specs/pipeline/cli.js
  specs/features/BL-1346-swarm-stamp-rc-launch-role-stale-marker-195de28861.feature`
  — still 5/5 pass, unchanged behavior.
- `npx vitest run --config vitest.properties.config.mjs
  bl1346RcRepairStampInvariants` — 3 consecutive runs, 3/3 each.
- The two sibling property files the coder touched for timeouts only
  (`bl1333StampOffInvariants`, `bl1342CrashloopStampInvariants`) —
  re-run, 6/6 pass, confirming the incidental timeout addition didn't
  regress either.
- No fixture directories leaked under `/tmp` after any run.

## No Scenario Outline
This feature has 5 plain `Scenario:` blocks, no `Examples:` — BL-113
Gherkin mutation is not applicable.

## Standing whole-tree guards
Same 3 pre-existing, already-ticketed failures as this session's
earlier passes (BL-1289/1290/1291) — confirmed by reading each guard's
violation list, none naming a file this ticket touches (post-fix).

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
One real gap found and fixed (third occurrence of the socket-fixture-root
defect this session, same review-harness family). Everything else
confirms the architect's clean sweep. Forwarding to documenter.
