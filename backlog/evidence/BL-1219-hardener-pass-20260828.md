# BL-1219 hardener pass — 2026-08-28

Merged architect handoff `3840f9b3c1` (clean pass, master-resident mailbox
resolution verified). No conflicts.

## Mutation cooldown gate (BL-149)

`extension/src/watchdog/chaserMonitor.ts` (the touched production file) is
`file_age_days: 0.46` — skip-cooldown. `swarmState.ts` (home of the shared
`mailboxDir`/`mailboxBaseDir` resolver this fix now calls into) is
untouched by this diff and well outside cooldown (`file_age_days: 36.84`,
decision `run`) but is not part of this parcel's changed-file scope, so it
is not mutation-tested here. Hardening below is BL-113 Gherkin mutation on
the acceptance feature (the applicable gate given the cooldown skip) plus
CRAP/DRY on the touched TS file.

## BL-113 Gherkin mutation

Ran `run_gherkin_mutation.sh` soft against `Scenario Outline: each role
resolves to the mailbox its mail is actually delivered to` (the only
Outline in this feature; the other 5 are plain `Scenario:`, nothing to
mutate per BL-638):

```
Total 2, Killed 2, Survived 0, Errors 0
```

Both mutants (`coder`→`Coder`, `coordinator`→`coOrdinator`) are killed via
`buildRoleInboxes(...)` returning nothing for the mutated role name — a
genuinely keyed filter (`rolesList.includes(entry.role)`) against the real
`roles.tsv`, not a shape-based branch (BL-908 class check: non-vacuous).

## Fixture-leak check (BL-1204-class hazard, checked deliberately)

This session's prior BL-1204 pass found two leak classes in a DIFFERENT
acceptance step file: a terminal step's cleanup only running after every
assertion passed, and an early step throwing before any cleanup ever runs.
Checked this file (`bl1219RoleInboxResolutionSteps.js`) for the same
hazard: the Outline scenario's early steps (`inbox resolution runs for
"<role>"`, `the resolved inbox is the one handoff delivery writes to for
"<role>"`) can both throw before the terminal step's own `try/finally`
cleanup ever runs — same shape as BL-1204's gap.

**Confirmed NOT a live leak here**, and verified by the same mutation run
above: 0 leaked `/tmp/bl1219-acceptance-*` dirs before and after, across
both killed mutants (each one throws in exactly the early step described
above). Reason it's safe: this file uses the shared
`mkSocketFixtureRoot`/`releaseSocketFixtureRoot` helper
(`specs/pipeline/steps/lib/socketFixtureRoot.js`), which installs its own
`process.on('exit')` backstop tracking every root it hands out and
removing stragglers regardless of whether the scenario's own cleanup ran
(that helper's own "Invariant 2" comment, added for exactly this class of
gap: "236 of 287 step files had no `finally` at all"). BL-1204's file used
a raw `fs.mkdtempSync` with no such backstop, which is why the same shape
was a real leak there and is not one here. No fix needed; recorded so the
next pass doesn't have to re-derive this.

## Verification

- `npm run compile`: clean.
- `vitest run test/chaserMonitor.test.js test/notifyDeadLettersCli.test.js
  test/stuckInProcessChase.test.js`: 33/33 pass.
- `run_acceptance.sh` on the BL-1219 feature, 3 consecutive runs: 7/7
  green each time.
- CRAP scoped to `chaserMonitor.ts`: `buildRoleInboxes` at CRAP 2.00, 100%
  coverage. Every other function in the file is at or under CRAP 4.05 (no
  new debt).
- DRY (`jscpd`) on `chaserMonitor.ts` + `swarmState.ts`: 0 clones.
- Standing whole-tree guards (parcel brought in new files under
  `specs/pipeline/steps/`): ran all 12 non-property `*Guard*.test.js`
  files. Same 4 pre-existing failures as the last two hardening passes
  this session (`liveRepoDerivationGuard`, `tmpDirMigrationGuard`,
  `tempDirTrapGuard`, `socketFixtureShortRootGuard`) — none name any
  BL-1219 file (see BL-1203-hardener-pass-20260828.md for the full grep
  against `backlog/active|paused|hold`, unchanged since).

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Deleted
`tmp/bl1219-gherkin-work/` (the mutation worker's own work dir) after the
run. 0 leaked fixture dirs at any point (see above).

By hardener.
