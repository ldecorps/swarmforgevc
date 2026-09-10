# BL-1449 amendment — the ninth drift is live on `main`; the standing red is folded in

**Specifier, 2026-09-10, on `main` at `0a4b497a58`.**
Inbound: QA `note`, priority `00`, 2026-09-10T11:30:31Z —
`unowned-red: operatorRuntimeBbFixtureClosure.test.js drifted again`.

**Disposition: FOLD INTO BL-1449 (re-class `severity: high`, amend, register row). No new ticket.**

## Reproduced, not taken on report

```
$ git rev-parse --short=10 HEAD
0a4b497a58
$ cd extension && npx vitest run test/operatorRuntimeBbFixtureClosure.test.js
 × the closure check names a removed dependency as missing, and clears once restored
 × OPERATOR_RUNTIME_BB_FILES covers the real transitive load-file closure of operator_runtime.bb, with no undeclared extras
AssertionError: expected zero missing dependencies, found:
respawn_bootstrap_lib.bb
 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```

This file is in the standing unit suite (`vitest.config.mjs`, every parcel's
`npm test`), so it is expected green.

## Traced to its site

`swarmforge/scripts/handoff_lib.bb` line 65 load-files
`respawn_bootstrap_lib.bb`, added by hotfix `32fb1ff7e1` (2026-09-09, "a
respawned pane gets the same bootstrap its first launch got"). The hotfix went
straight to `main`, so no pipeline stage ran the unit suite against it. The
hand-typed `OPERATOR_RUNTIME_BB_FILES` in
`specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` (last caught up by
BL-1439 on 2026-09-06, `ed6fb8892b`) does not name it. That is the NINTH drift
of the list BL-1449 already counts eight of; BL-944's guard did its job and
named the file, and the list is still a list.

The same hotfix is the cause of BL-1503's red
(`bl1313BatchGuardVisibilityInvariants.property.test.js`), but that is a
DIFFERENT hand-typed copy of a different entry point's closure and a different
test file; BL-1503 stays its owner. This file's list is BL-1449's.

## Why fold rather than mint

BL-1449 (paused, approved 2026-09-06) exists precisely to end this drift class:
its deliverable computes the export from BL-944's own closure walk at module
load, so `respawn_bootstrap_lib.bb` is in the fixture the moment the load-file
exists and the red clears by construction — no ninth retype. A second ticket
would be a duplicate owner for one defect (BL-1398/BL-1399's warning), and a
"just add the name" fix is the exact gesture the ticket's `approval_context`
marks FIRM against (no typed names).

What changes is the ticket's class, not its scope. BL-1449 was `medium` on the
stated ground that "nothing is broken on main today". Since 2026-09-09 that
ground is false: a standing unit-suite test is red on `main`, which is a broken
safety signal and blocks QA approval under Article 4.2 for every parcel whose
evidence names it. Per the standing-red rule (2026-09-05: "a ticket that
already owns a red is re-classed high"), BL-1449 is now `severity: high`,
which puts it in the Article 3.2.4 expedite lane.

## Changes

- **BL-1449** — `severity: medium` -> `high` with the rationale rewritten;
  new description section "Ninth drift, live on main" naming the hotfix, the
  missing file, and the constraint that the red is NOT cleared by retyping the
  name; `qa_e2e_procedure` step 1 now names the red it must turn green and a
  new step 5 requires the register row gone in the same land; `notes:` records
  the fold. Feature file and `human_approval: approved` unchanged — no new
  scenario, no new choice.
- **backlog/standing-reds.tsv** — one `unit` row,
  `extension/test/operatorRuntimeBbFixtureClosure.test.js` -> BL-1449,
  `first_seen 2026-09-09`.

## For the coordinator

BL-1449 is now expedite-eligible (defect/high). Its parcel is `low` on every
envelope and touches only `operatorRuntimeBbFixtureFiles.js` plus one new
handler, so it is orthogonal to BL-1503 (which edits a property test and its
own handler) and to BL-1494. Both BL-1449 and BL-1503 should land before the
next hotfix adds a tenth load-file.
