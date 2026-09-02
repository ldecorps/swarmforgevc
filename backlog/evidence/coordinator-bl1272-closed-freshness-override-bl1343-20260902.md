# BL-1272 closed (landed 08-30); freshness override; BL-1343 noted — 2026-09-02 ~18:30 UTC

## Trigger
Specifier `note` (priority `00`, `001191`): "BL-1343 minted for BL-1338
blocker; BL-1272 landed, move to done/".

## BL-1272 — confirmed landed, closed paused/ -> done/
Ticket was `backlog/paused/`, `status: blocked`, with its own 08-30
adjudication note: clears "the moment BL-1297 lands and QA's re-run of
`land_step_cli.bb` puts this parcel's content on main; then it goes
straight to backlog/done/ … Whoever clears it should confirm the landing
happened rather than trusting this note." Confirmed POSITIVELY on
`origin/main`, not from the note:
- `specs/pipeline/steps/index.js` registers bl1272 (landed by
  `ec0584131b` 2026-08-30 07:22Z "BL-1272: a sibling whose work already
  landed is not reported as entangled");
- handler steps file present; `specs/features/BL-1272-…feature` present
  (3 scenarios);
- `land_step_lib.bb:104-108` carries the ticket's "invariant 1: landed is a
  POSITIVE finding" text.
No QA parcel names BL-1272 in my mailbox (it never went active/ -> QA in
the ordinary way; its content rode the BL-1297 land-step work). The close
gate accepted the paused/ -> done/ move: `bd3cd0afca` "Close BL-1272:
landed 2026-08-30 (ec0584131b), paused -> done per its adjudication note".
Set `status: done` and appended a dated provenance line to `notes:`.

### Shared-checkout collision during the close
First attempt: `git mv` failed on `.git/index.lock` (another writer —
specifier or the freshly restarted handoffd reconcile); `commit_integrity_cli`
then reported `commit-failed … INDEX LEFT DIRTY: restoring the caller's
paths … also failed`. State: paused path staged as deleted, my edited file
left UNTRACKED at the paused path, nothing in done/. Repair (no stash, no
reset, nothing deleted): waited for the lock (bounded 20 s), verified the
untracked file == HEAD + exactly my 5 edited lines, `git restore --staged
-- <src>` (index back to HEAD, edits kept as `M`), then redo `git mv` +
`commit_integrity_cli`. Recorded in memory as a recipe.

## Build-freshness (BL-328) — override, logged one-shot
`build_freshness_cli.bb . sync` REFUSED: "main is not QA-approved —
offending 195de28861, 27d6ab8630". Both are human operator hotfixes with
`Hotfix-Certification: pending` (BL-848 stamps: BL-1342 minted for
`27d6ab8630`; `195de28861`'s pending). ALL six daemons were stale. Same
class the coordinator overrode earlier today for the BL-1301/BL-1314
land-step replays (`coordinator-babysitter-article42-false-positive-20260902.md`).
Ran `sync --override`: restarted front-desk, handoffd, operator;
`report` now shows **none stale**, every process on `822f1022a1`
(= main tip). Confirmed, not assumed.

## BL-1343 (paused)
"replay drops the ticket's own path" — `type: defect`, `severity: high`,
`priority: 4`, `human_approval: approved`, `mutation_cost: medium`. It is
the ticket for the BL-1338 land-step attribution defect. Expedited
(Article 3.2.4) and approved → top candidate the moment a slot opens.
Active is 4/4 (cap 4); this close was paused/ -> done/, so no slot freed.
No promotion this turn.

By coordinator.
