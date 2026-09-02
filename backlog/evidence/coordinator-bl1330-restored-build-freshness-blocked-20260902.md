# BL-1330 QA restore landed — build-freshness sync blocked — 2026-09-02

## QA note received
`type: note`, priority `00`, from QA: "BL-1330 restored: merge b71c941a19
dropped it, pushed e358e1b46e" (in_process handoff
`00_20260902T155126Z_002125_from_QA_to_coordinator_for_coordinator.handoff`).

Continuation of [[coordinator-bl1330-content-dropped-by-human-merge-b71c941a19-20260902]].

## Step 0 — main sync
`bb swarmforge/scripts/main_sync_status_cli.bb .` → `{"ahead":0,"behind":0,"ready":true,"action":"proceed"}`.
Checkout already absorbed `origin/main` at `e358e1b46e`.

## Verified content restored
`HEAD` = `e358e1b46e` ("BL-1330: restore content dropped by human merge
b71c941a19"). Confirmed present on `HEAD`:
- `specs/pipeline/steps/bl1330SwarmStampBobAnthropicStartingCastSteps.js`
- `specs/pipeline/steps/lib/bl1330QwenRemapPredicateCli.zsh`
- `specs/pipeline/steps/index.js` registration entry

Ticket was already `backlog/done/M8/BL-1330-...yaml` from the original
close — no backlog move needed this pass, this was purely a re-land.

## Step 1 — build freshness sync BLOCKED
`bb swarmforge/scripts/build_freshness_cli.bb . sync` refused:

> REFUSED - uncommitted changes under the deployed code surface
> modified path(s): extension/src/tools/providerChatSeat.ts
> extension/src/tools/providerChatSeatLive.ts
> swarmforge/scripts/open_swarm_spy_router.sh
> swarmforge/scripts/spy_router_pane_label.sh

These four files are **untracked** (`??` in git status), not modifications
to tracked files. They are not mine — I did not create them and am not
touching/deleting them (guardrail: never delete/move a file you did not
create). Investigated before considering `--override`:
- Not imported/referenced by anything else in `extension/src/` or wired
  into any `.conf`/`.bb`/`.sh` elsewhere in the tree.
- No git history at all (never committed, on no branch).
- Content reads as human/operator scratch work in progress ("Operator test
  seats: bind a Telegram forum topic to a direct OpenAI-compatible chat
  provider", and a tmux "resident-spy" viewer script for a mono-router
  pack) — plausibly the human's own WIP, deliberately left uncommitted.

**Did not use `--override`.** `providerChatSeat.ts`/`providerChatSeatLive.ts`
sit under `extension/src/tools/` — TypeScript's build normally compiles
every file under `src/` regardless of git-tracking state, so overriding
this guard risks compiling and deploying unreviewed, unticketed,
un-QA'd code into the live daemons (`bridge`, `bot`, `handoffd`, etc.) —
exactly the failure class BL-328's guard exists to stop. That risk is
worse than leaving 4 processes running one commit stale for now.

## report confirms exact staleness
`bridge` and `bot`: fresh (`e358e1b46e`, already restarted since the
BL-1330 restore landed).
`front_desk_supervisor`, `handoffd`, `handoffd_supervisor`,
`operator_runtime`: stale, still on `b71c941a19` — running WITHOUT the
BL-1330 restore.

## Open concern for the human
Two untracked files under the deployed code surface
(`extension/src/tools/providerChatSeat*.ts`) and two untracked scripts
(`swarmforge/scripts/{open_swarm_spy_router,spy_router_pane_label}.sh`)
are blocking the BL-328 restart-sync step. Please either:
1. Commit them (through the normal pipeline) if they're ready, or
2. Explicitly confirm it's safe to `--override` past them (they're inert
   scratch/WIP and won't get swept into a build), or
3. Stash/move them aside yourself if they're not meant to be there yet.

Until one of those happens, `front_desk_supervisor`/`handoffd`/
`handoffd_supervisor`/`operator_runtime` keep running one commit behind
`main` — not a correctness emergency (BL-1330's restore is unrelated to
what those daemons execute moment-to-moment) but a real staleness gap per
BL-328's own standard, reported loudly rather than closed over in silence.

## Bookkeeping this turn
- No `active/` → `done/` move needed (BL-1330 already in `done/`).
- Active backlog already at effective cap (4/4) — no promotion/recheck
  action needed.
- Completing this in_process parcel via `done_with_current_task.sh` since
  the QA note has been fully actioned (verified restore, attempted and
  reported the freshness-sync blocker) — no forward handoff needed, this
  was a merge-up note, chain ends here.
