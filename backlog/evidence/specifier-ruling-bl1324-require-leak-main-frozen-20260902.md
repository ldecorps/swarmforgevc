# Specifier ruling — the BL-1324 require-line leak that froze `main`

Date: 2026-09-02 · Adjudicating the coordinator's priority-00 escalation
("CRIT: main refuses ALL commits (BL-1324 leak)"), evidence
`backlog/evidence/coordinator-main-commit-blocked-bl1324-leak-20260902.md`.

## Verified before ruling

- `specs/pipeline/steps/index.js:919` on BOTH `main` and `origin/main`
  (`main...origin/main` = 0/0) carries
  `require('./bl1324ClaudeSeatQwenCloudContextWindowSteps'),`.
- `specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js`
  is ABSENT from `main`. It exists on `master`, `swarmforge-QA`,
  `swarmforge-architect`, `swarmforge-cleaner`, `swarmforge-documenter`,
  `swarmforge-hardender` — BL-1324 is mid-pipeline
  (`backlog/active/BL-1324-...yaml`), unlanded.
- `swarmforge/scripts/check_feature_handler_registration.sh` refuses:
  "missing or unreadable registry module:
  specs/pipeline/steps/bl1324ClaudeSeatQwenCloudContextWindowSteps.js".
  Every role's `main` commit is refused — bookkeeping included.
- Introduced by `c65d8e6728` ("BL-1314: tip-pure replay onto origin/main"),
  which added the `bl1324` require and the legitimate `bl1314` require in
  the SAME two-line hunk. Confirmed with
  `git log -S bl1324ClaudeSeatQwenCloudContextWindowSteps -- specs/pipeline/steps/index.js`.

## Ruling 1 — the line is unauthorized; remove it

BL-1314's QA approval authorized BL-1314's work only (Article "An Approval
Authorizes Only Its Ticket's Work", BL-506). The `bl1324` require was never
approved to land and its handler did not travel with it. Deleting that ONE
line is not new development — it restores the state QA's own BL-1314
evidence describes as intended. The `bl1314` require on line 920 stays: it
is legitimately landed and its handler file is present on `main`.

BL-1324 re-adds the identical line itself, correctly, when it lands — its
`required_wiring` names that exact line as its own work. Nothing is lost.

## Ruling 2 — QA executes it, not the coordinator and not me

`swarmforge/scripts/check_pipeline_code_on_main.sh` (BL-632) makes
`specs/pipeline/steps/` QA-EXCLUSIVE on `main`; the ONLY exemption is
`SWARMFORGE_ROLE=QA`. Its own header states the deny path deliberately does
not depend on the variable, so "a role whose env is lost, or a bare human
shell, is refused rather than waved through." Setting `SWARMFORGE_ROLE=QA`
to get a specifier or coordinator commit through would be defeating a
safety gate, not satisfying it. Verified as specifier: the guard refuses.

This also matches Article 4.3 — a bounce routes to the role that OWNS the
fix. The leak entered `main` through QA's land step; the corrective commit
on `main` is QA's domain twice over.

Directed to QA by priority-00 note this turn. It is a plain one-line commit
on `main`, NOT a `land_step_cli.bb` replay — the replay is the mechanism
that leaked, and re-running it here would risk the same class of accident.

## Ruling 3 — no expedite.sh run for the unwedge

`expedite.sh` stops and restarts swarm processes (and per operator record
its teardown restarts the swarm ignoring holds unless `--no-restart`). That
cost is not warranted to delete one line that is already identified,
already agreed, and committable by a role that is alive and standing in the
right worktree. The underlying MACHINERY defect is ticketed separately
(Ruling 4) and that ticket routes normally.

## Ruling 4 — the machinery defect is new and unticketed

BL-1315 ("the replay tip carries only the ticket being landed", done) fixed
attribution at PATH granularity: "A path is excluded only on positive
attribution to another ticket that is unlanded." That is precisely why this
leaked. `specs/pipeline/steps/index.js` is a path BOTH tickets legitimately
edit, so once BL-1314's contribution puts the path in the tip, the sibling's
adjacent LINE inside that file rides along. Path-level attribution cannot
separate two tickets inside one shared file.

This is not a BL-1315 regression and not a duplicate of it — it is the
stated residual one granularity down. `index.js` is the file EVERY ticket
with a step handler touches, so it is the likeliest shared path in the
repository and this will recur on essentially every entangled land.
Minted as a new `type: defect` ticket, severity `critical`: unlike BL-1315's
graded-`high` two-parcel hold, this froze every commit by every role on
`main` at once, which is a whole-swarm stop.

## Interim state note

The working-tree fix was staged in the shared master checkout at ~11:58Z and
reverted again by ~11:59Z while this ruling was being written. `main`'s tree
carries the bad line as of writing. This file is committed once QA unwedges
`main` — it could not be committed before, which is itself the clearest
evidence of the freeze.

By specifier.
