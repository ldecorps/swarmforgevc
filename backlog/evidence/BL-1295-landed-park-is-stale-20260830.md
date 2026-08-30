# BL-1295 has landed — the park is stale and it is holding the only active slot

**Written:** 2026-08-30 ~20:05Z, by the specifier, from an idle `ready_for_next.sh`
returning `NO_TASK`.
**Disposition:** the swarm is idle with nothing in flight, and the single active
slot is held by a ticket whose work is already on `main`. Freeing it is
**coordinator bookkeeping** (Article 1.1 / 3.3), not a specifier action, so this
file is the evidence behind the priority-`00` note asking for it.

## The park was correct when it was set, and is not correct now

BL-1295 was parked at QA with `status: blocked` (commits `724a953ea5`,
`41afdcff87`). The recorded blocker was BL-1297, then BL-1298: QA could not run
its land step, so the parcel sat intact on `swarmforge-QA` rather than being
bounced. That was the right call.

BL-1297 has since landed and closed (`c49a53d9f6`, ticket now in
`backlog/done/`). Landing it merged the QA branch into `main`, and BL-1295's own
QA merge rode along inside that merge. So BL-1295 landed as a passenger, without
its own land step ever running — which is exactly why nobody told the
coordinator, and why the park is still written in the ticket.

## Verified on `main`, not inferred

| # | Check | Result |
|---|---|---|
| 1 | `git merge-base --is-ancestor 0c550b4bcb main` (the QA merge `Merge documenter BL-1295 7554d6855a into QA`) | **YES** — real ancestry, not phantom content |
| 2 | `revert-subject?` in `main:swarmforge/scripts/task_scope_gate_lib.bb` | present, line 275, with `subject-names-task?` beside it |
| 3 | `bl1295RevertSubjectAttributionSteps` in `main:specs/pipeline/steps/index.js` | **registered**, line 655 — not merely a file on disk |
| 4 | `main:specs/features/BL-1295-...feature` | present, 3 scenarios, byte-identical to the parcel tip |
| 5 | `main:specs/pipeline/steps/bl1295RevertSubjectAttributionSteps.js` | present; diff vs parcel tip is `+8` lines only, additive |
| 6 | `git log -S 'revert-subject?' --first-parent main` | introduced by `0c550b4bcb` — a commit that genuinely authored it |

Check 3 is the one that matters most: BL-1253's "partial resurrection" failure
mode is a feature file landing with its handler file present but *unregistered*,
which leaves `main` red. That is not what happened here — the registration is on
`main`.

## What follows for the blockers

- **BL-1298 no longer blocks BL-1295.** It was named only as the second half of
  "QA re-runs `land_step_cli.bb` once BL-1297 and then BL-1298 have landed". The
  land never had to be re-run, so that dependency is spent. BL-1298 remains a
  real paused defect on its own merits — this is not a reason to close it.
- **BL-1240's blocker is genuinely gone.** It was blocked at the documenter→QA
  hop by precisely the scope-gate defect BL-1295 fixes, and that fix is now on
  `main`. BL-1240 sits in `backlog/hold/` with `status: todo`. Article 3.1 makes
  `hold/` human-held — *never* auto-promoted — so this file only records that the
  reason it was parked has expired. Releasing it is the human's call.
- Six other tickets sit in `hold/` alongside it (BL-1210, BL-1218, BL-1225,
  BL-1252, BL-1253, BL-1264), all moved there by `66be60ea40` as "orphaned by a
  dead expedite run for BL-1295". Several carry coder/architect/hardener evidence,
  so they are part-built work, not fresh tickets. Same Article 3.1 posture: flagged,
  not touched.

## Why this is worth a note rather than a shrug

With `active_backlog_max_depth` at `1`, one stale park is the difference between
a working pipeline and a stopped one. Measured at the time of writing: all eight
role sessions alive (created 19:57), **every** mailbox empty — the only files in
any `inbox/new` are ten `.chase.json` artifacts from 2026-07-09 and one
zero-byte `.dead` — and 99 tickets waiting in `paused/`. Nothing is moving, and
nothing will, until the slot is freed.

## Two things found on the way, recorded so they are not lost

1. **A ticket-id collision, now resolved** (commit `351eb0f7c8`). Two unrelated
   defects were both minted `BL-1294` on 2026-08-30 — the fixture-closure-resolver
   at 06:54 and the acceptance-fixture agent-binary PATH-shim at 07:52. The later
   one is renumbered **BL-1305**. The collision had already misdirected a human
   approval: sweep `2830aec113` recorded "approve BL-1294" against the
   agent-binary file, while the Telegram topic `BL-1294.json` the human was shown
   renders the *closure-resolver* ticket. Neither ticket can prove the tap was
   its own, so **both are left `human_approval: pending`** and ask again. Losing
   one tap is cheaper than shipping a ticket on an approval nobody gave it.
2. **The hygiene gate's `DUPLICATE-ID` on that pair is the known false positive**
   (BL-1194's bug #3). Discriminator applied by hand: `git ls-tree -r
   --name-only origin/main backlog/` still lists the pre-rename path because the
   rename is unpushed, while on disk `grep '^id: BL-1294'` matches exactly one
   file. The gate has no clean invocation for an amended, already-published
   ticket; the FAIL was verified by hand and the commit made anyway.

## Not swept

`swarmforge/scripts/wait_pipeline_drain.sh` is untracked in the master checkout
and was not created by this turn. A copy is already preserved as
`backlog/evidence/uncommitted-draft-wait_pipeline_drain-20260830.sh`, so it is
surfaced here and left exactly where it is.
