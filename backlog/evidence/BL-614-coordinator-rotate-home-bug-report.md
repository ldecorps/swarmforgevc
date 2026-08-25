# Bug: mono-router `rotate-home?` fires for the coordinator role, killing the coder pane

## Observed
2026-07-24 ~10:41 BST. Coordinator (this role) ran
`swarmforge/scripts/ready_for_next.sh` per its normal idle instructions.
Under this swarm's `mono-router` pack (`.swarmforge/swarm-identity` shows
`rotation	router`, home role `coder`), the script printed `ROTATE_HOME` /
`HOME_ROLE: coder` and auto-exec'd `rotate_to_role.sh coder`, which targets
`mono-router-resident-session` — always resolved to the `swarmforge-coder`
tmux session regardless of who called it. This ran `tmux respawn-pane -k`
against the CODER pane, killing its live Claude process mid-task (BL-608)
and relaunching it fresh. It recovered because BL-608 was already claimed in
`in_process/`, so the fresh session's `RESUME-ON-START` picked the ticket
back up — but the live conversation/progress was lost and an unwanted
respawn was burned.

## Root cause
`ready_for_next_task.bb`'s `report-no-task-or-rotate!` calls
`mono_router_lib.bb`'s `rotate-home?`, whose gate is only:

```clojure
(and rotation-router?
     mailbox-empty?
     role
     (not= (str role) (str home-role)))
```

This has no check that `role` is actually a rotation-eligible pipeline role.
The coordinator's mailbox was "empty" (no real `.handoff` file, only stray
`.claim-progress.json` sidecars with no matching handoff — a separate,
smaller cleanup item, not this bug's cause) which satisfied `mailbox-empty?`,
and `role="coordinator" != home-role="coder"` satisfied the rest. So the
guard fired for the coordinator exactly as it would for a genuinely dormant
pipeline role — even though the mono-router pack prompt explicitly documents
the coordinator as "Reserved infrastructure, never part of the rotation,
always its own separate session."

## Why it will recur
The coordinator's own idle instructions say to run `ready_for_next.sh` when
idle. Under this pack, that call is unsafe any time the coordinator's own
mailbox happens to be empty (the common case) — it will keep respawning
whatever pane `mono-router-resident-session` resolves to, without regard for
whether that role is mid-task. "Mailbox empty" does not mean "coder idle."

## Suggested fix
Add an explicit exclusion in `rotate-home?` (or one layer up, in
`report-no-task-or-rotate!`) so it never returns true when
`role = "coordinator"` — the coordinator has no rotation "home" to return to
and must never be redirected into respawning another pane. Cover with a unit
test asserting `rotate-home?` is false for `{:role "coordinator" ...}`
regardless of `mailbox-empty?`/`home-role`.

## Secondary, lower-priority observation (found while investigating, unrelated root cause)
`swarm_handoff.bb`'s depth-warning check (~line 199) does
`(count (fs/list-dir active-dir))`, which counts `backlog/active/.gitkeep`
as an entry. With one real ticket active (BL-608) plus `.gitkeep`, it just
printed `WARNING: Active backlog depth exceeded (active=2, max=1)` even
though real active count is 1 and matches the cap exactly. Coordinator did
NOT promote off this false warning (verified real count by `ls`). Fix:
filter to `*.yaml`/`*.yml` (as `swarm_handoff.bb`'s own line ~395
`fs/glob active-dir "**.yaml"` already does elsewhere) rather than raw
`fs/list-dir`.

## Tertiary, lower-priority observation
`.swarmforge/handoffs/coordinator/inbox/in_process/` currently holds 4 stray
`*.handoff.claim-progress.json` sidecar files (from 2026-07-23/24) with no
matching `.handoff` file — leftover cruft, not itself the cause of this bug,
but worth a cleanup pass since the sidecar-removal-on-move logic (BL-232)
apparently didn't clear these.
