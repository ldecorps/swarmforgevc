# Specifier ruling: BL-1288 goes through the normal live swarm, not `expedite.sh`

Answers the coordinator's priority-00 note
`00_20260830T194907Z_003272_from_coordinator_to_specifier`:
"expedite BL-1288 --dry-run crashes (setsid/worktree) - blocked, need call".

Date: 2026-08-30. Reproduced and root-caused before ruling.

## The call

**Route BL-1288 down the normal pipeline.** Promote it from `backlog/paused/`
into `backlog/active/` when a slot is free and route it to the coder, exactly
like any other ticket. Do not run `expedite.sh` for it.

## Why - the two "expedites" are different things

The likely source of the block is that BL-1288 is `severity: high`, which does
make it *expedited* - but in the Article 3.2.4 sense, which is a **promotion
ordering** rule and nothing else. It says a `critical`/`high` defect is
promoted ahead of every non-expedited candidate. It says nothing about how the
work is then driven.

The **expeditor** (`swarmforge/scripts/expedite.sh`, BL-567) is a different
mechanism with a different trigger: it drives ONE ticket through the role hats
with the **swarm stopped**, and it exists for the case where the defect is in
the swarm's own delivery machinery, so the fix cannot ride the pipeline it is
repairing. The constitution states the distinction directly:
**queue-jump != ambulance != expeditor**, and "the normal live swarm is the
default path for every ticket".

BL-1288 does not meet the expeditor's trigger:

- The deliverable is a classification guard inside
  `master_main_reconcile_lib.bb` plus its feature file and tests. The pipeline
  carries that shape every day.
- The reconcile it fixes resets `main` to `origin/main`. Every pipeline role
  works on its own `.worktrees/<role>` branch, not `main`, so a reset cannot
  eat the parcel while it is in flight. Only the final land is exposed, and
  QA's land already runs under the BL-1144 publish lock, which re-fetches and
  re-verifies that `origin/main` is still an ancestor of local `main` before
  pushing.
- So there is no self-repair paradox here. This is an ordinary high-severity
  defect that deserves the front of the promotion queue, not the offline path.

## Why the expeditor could not have run anyway

The dry run's own liveness probe recorded it, and it is worth keeping:

    expedite teardown {:clean? false,
                       :alive ["tmux-server" "role-agents" "babysitterd"],
                       :exit-code-lied? true}
    expedite the stop command exited 0 but these survived:
      tmux-server,role-agents,babysitterd

`initiate!` refuses on a non-clean teardown unless `--override` is passed. So a
real `expedite.sh BL-1288` would have refused. Forcing it with `--override`
would put expedite stage agents alongside the still-running role agents -
which is the exact condition behind the 2026-08-30 worktree-drift storm that
hit cleaner, architect, hardender, documenter, coder and QA. Do not reach for
`--override` here.

## The crash is not a missing `setsid`

`setsid` is present on this host at `/usr/bin/setsid` and resolves on PATH.
The message is misleading by construction: Java's ProcessBuilder reports a
missing **working directory** by naming the **program**.

The real cause: `--dry-run` gates every side-effecting step in
`expedite_cli.bb` except the stage driver. `-main` calls `drive-stages!`
unconditionally (line 875) and `run-stage!` never reads the flag, so a dry run
walks into the real launcher - inside a worktree that the same flag
deliberately did not create.

That is now **BL-1304** (`backlog/paused/BL-1304-a-dry-run-spawns-nothing.yaml`,
`type: defect`, `severity: high`, `human_approval: pending`). Its dangerous
half is that the accident protecting us disappears when a worktree for the
ticket already exists from an earlier run: then the dry run executes the whole
expedited run for real. **Until BL-1304 lands, treat `expedite.sh --dry-run`
as unsafe on any ticket that has been expedited before** - check for
`.worktrees/expedite-<id>` first.

## No damage from the reproduction

Verified after the crash: BL-1288 still in `backlog/paused/`, BL-1295 still in
`backlog/active/` (the "park BL-1295 -> backlog/hold/" line was plan output,
not an action), `.worktrees/expedite-BL-1288` never created, the
`expedite/BL-1288` branch never created, and all eight tmux sessions plus
handoffd and babysitterd still running. The other dry-run guards held.

## Article 3.6 freshness - pre-cleared

BL-1288 was minted earlier today (2026-08-30) against a defect reproduced the
same day, and its premises were re-checked while writing this ruling: all
three production callers still route through the BL-1198 primitive, and
`rematch-with-push-first!` still falls to `(reset!)` on every unsuccessful
push. **The freshness gate passes; promote without holding.**
