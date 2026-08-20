# Human hotfix 596098dc3 is partially undone on in-flight branches (leaks real processes)

Coordinator finding, 2026-08-20, while working the specifier's BL-964 note.
**Actionable by: hardener (holds the branch). Guard ticket: BL-964.**

## The hotfix
`596098dc3` (human, via Cursor; landed by specifier per operator intake) corrected
`swarmforge/scripts/test/test_swarm_ensure.sh` fake-injection env vars to the names
`swarm_ensure.bb:101` actually reads, "so ensure tests never launch real VS Code".
On `main` it is complete: **0** occurrences of the dead `SWARMFORGE_ENSURE_*`
spelling, 47 of the live `SWARM_ENSURE_*_CMD`.

## The problem
In-flight branches still carry the dead spelling in test blocks `main` does not have:

    main                  OLD=0   NEW=47   (clean)
    swarmforge-hardender  OLD=7   NEW=51
    swarm/coder           OLD=30  NEW=26
    swarmforge-architect  OLD=30  NEW=26

The dead names inject nothing, so those fixtures fall through to the REAL commands.
This is not speculation — the hardener's own BL-571 comment (line 568) documents the
measured consequence: *"ensure ran the REAL extension bounce and the REAL daemon start
against this temp root. The assertions still passed (they only look at DORMANT and the
respawn log) while live processes were spawned; a measured run left a PPID-1
babysitterd rooted in $TMPDIR behind."*

## Precisely what is left, and what is NOT a defect
- **NOT a defect:** the BL-571 block itself is already correct — the hardener diagnosed
  this and uses `SWARM_ENSURE_*_CMD` at lines 575-577. Line 570 is its explanatory
  comment, not a live invocation. Do not "fix" these.
- **Defect:** two **BL-958** control-plane fixtures still use the dead spelling on
  `swarmforge-hardender`, at lines **628-630** and **673-675**
  (`SWARMFORGE_ENSURE_EXTENSION_CHECK` / `_BOUNCE` / `SWARMFORGE_ENSURE_SUPERVISOR`,
  the last pointing at `fake_supervisor.bb`, a stub `make_fixture` never creates).

## Why it matters now
BL-571 and BL-958 are both active. If either lands carrying those two fixtures, the
human's hotfix is **partially reverted on main** and the suite silently resumes
spawning real processes — passing all the while, since the assertions only inspect
DORMANT and the respawn log. That is the exact silent-failure shape the hotfix
existed to end.

## Notes
- The hotfix is **not recorded in `backlog/hotfix-ledger.yaml`** (grep: no match for
  the sha, `SWARM_ENSURE`, or `test_swarm_ensure`). Flagged for whoever owns that ledger.
- BL-964 is the minted regression gate for exactly this wrong-prefix class, but it is
  `chore`, `priority: 60`, `human_approval: pending` — it would arrive well after the
  two fixtures above could land. Fixing them at the branch is not optional on BL-964.
