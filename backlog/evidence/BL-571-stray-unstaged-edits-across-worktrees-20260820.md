# BL-571 edits appearing unstaged in non-owning worktrees — surfaced, NOT swept

Raised by: architect (priority-00 note 20260819T231959Z_000268), which left them
untouched and reported. **That handling was correct.** Coordinator diagnosis follows.

## What the edits are — legitimate, not garbage
They rename stale test-harness env seams to the REAL ones:

    SWARMFORGE_ENSURE_EXTENSION_CHECK  -> SWARM_ENSURE_EXTENSION_CHECK_CMD
    SWARMFORGE_ENSURE_EXTENSION_BOUNCE -> SWARM_ENSURE_EXTENSION_BOUNCE_CMD
    SWARMFORGE_ENSURE_SUPERVISOR       -> SWARM_ENSURE_SUPERVISOR_CMD
                                          (fake_supervisor.bb -> fake_daemon_start.sh)

The NEW names are the correct ones: `swarm_ensure.bb:101` reads
`SWARM_ENSURE_SUPERVISOR_CMD`, and it is documented in `docs/reference/Specification.MD`
and BL-690. The old names match nothing. So this is real BL-571 D1 parity-gate
re-fix work, not stray junk — deleting it would destroy correct work.

## Where it sits (md5 of working-tree files)
    master / documenter / QA : steps file absent; ensure = c94d123c (committed version)
    coder / cleaner / architect: steps = ab2ddc7c, ensure = c69a5ff7  (IDENTICAL trio)
    hardender                : steps = 819f474b, ensure = 605c5a4d  (its own, further evolved)

Not a line-ending artifact: `git diff -w` shows the same 33/33, and both files are
LF in worktree and index despite `core.autocrlf=input`.

## Assessment
- **No work is at risk of loss.** BL-571 is at the HARDENER (pipeline_stage sync),
  and the hardener holds its own further-evolved copy. The authoritative line is safe.
- The identical trio in coder/cleaner/architect are **strays** — those roles do not
  own BL-571 (architect holds BL-957; cleaner is idle).
- Appeared ~00:17 local / 23:17Z in several checkouts at once, which is the BL-373
  hot-sync propagation shape, here reaching `specs/pipeline/steps/` and not only
  `swarmforge/scripts/`. Logged as a recurrence, deliberately not re-diagnosed.

## Action taken: NONE, by design
Per "never delete, move, or `git clean` a file you did not create", the coordinator
restored/removed nothing. The hazard is a role **sweeping** a stray into an unrelated
commit (BL-506: an approval authorizes only its own ticket's work). Roles holding
strays must stage only their own ticket's paths and leave these unstaged.
