# Dogfood loop, observations 6 and 7 (2026-10-03, specifier)

The human's loop (backlog/archive/INTAKE-coder2-tool-calls-20261003.md):
observe the qwen2.5-coder-14b coder seat, raise high-severity defects,
the specifier implements them, repeat. Sources: the seat's qwen chat
recordings under `~/.qwen/projects/-home-carillon-swarmforgevc--worktrees-coder/chats/`,
`.swarmforge/local-model-shim/shim.log`, `.swarmforge/daemon/handoffd.log*`.

## Observation 6: "Let's ..." plans were never nudged (hotfix 59a376845a, BL-1923)

Session 3b35e6c1 (11:13:49Z) and 0cd72429 (11:19:30Z) each ended turns on
a numbered plan closing "Let's proceed with these steps." with no tool
call. shim.log shows `nudge=none finish=stop` on each. BL-1920's detector
had no "let's". handoffd then logged `chase-respawn coder` after 100-160 s
idle; there were 10 of those between 10:09Z and 11:19Z.

Replay (card, the blocked PARCEL_LINE serving, git status, the refused
commit, the "Let's proceed" plan, then the nudge): `read_file` on the
manifest 3 of 3.

## Observation 7: the served ACTION text sent the seat to the lander (hotfix 4b0e9adb96, BL-1924)

Session 3c0850be (11:24:51Z), after `PARCEL_LINE: moved swarmforge-coder
onto 59a376845a`:

| time (Z) | call |
|---|---|
| 11:25:13 | `merge_and_process coordinator bf29d1ddd0` -> exit 127 |
| 11:25:18, 11:25:28 | glob `**/*merge*`, `swarmforge/scripts/*merge*` |
| 11:25:35 | `./swarmforge/scripts/land_merge_path.bb` -> permission denied |
| 11:25:43 | `chmod +x ./swarmforge/scripts/land_merge_path.bb` |
| 11:25:58, 11:26:14, 11:26:41 | `land_merge_path.bb swarmforgevc/.worktrees/coder BL-1916 bf29d1ddd0` -> "does not resolve", bad `cd` |
| 11:28:46 | `merge_and_process ...` again after a respawn |
| ~11:32Z | `nano swarmforge/scripts/land_merge_path.bb` (pid 4955) |

The lander run failed on its relative path before it took the land lock or
touched main. The specifier undid the chmod (mode-only change) in the coder
worktree.

## Also seen, not fixed in these two hotfixes

1. **Write-file clobber.** At 11:14:41Z the seat "added" the row
   check_test_file_registration suggested
   (`local_llm_lib_test_runner.bb<TAB>standing`) with `write_file`, which
   overwrote all 609 lines of `swarmforge/scripts/test/suite-manifest.tsv`
   with one line. qwen's shell tool hands it the guard output through a PTY,
   so the tab arrives as four spaces, and the guard refused the row again.
   Restored in the coder worktree from HEAD. A guard message that gives a
   copy-pasteable append command (`printf '%s\tstanding\n' <file> >> <manifest>`)
   would survive the PTY; not done yet.
2. **Another ticket's work in the seat's worktree.** The test file it tried
   to commit, `swarmforge/scripts/test/local_llm_lib_test_runner.bb`, is
   BL-1861's TDD runner (header comment), written 09:20:16Z, 11 s before the
   09:20:27Z relaunch requeued BL-1861's Work note. It was staged in the
   coder worktree and blocked every BL-1916 take-up ("uncommitted changes to
   tracked files"). The seat's only remedy offered was "Commit or restore
   them", and it chose commit, under BL-1916's name. The specifier preserved the
   file on `refs/heads/swarmforge-coder-bl1861-wip` (79c8fd098c, byte-identical,
   checked with cmp), then removed it from the coder worktree. Whoever takes
   up BL-1861 next starts from that ref.
3. **Respawn cadence.** handoffd's chase respawns the qwen seat after about
   100 s idle with mail waiting (`liveness=unknown`, since qwen has no
   heartbeat hook). It recovers a stalled seat, and it throws away the
   conversation every time. A long Ollama generation does not count as
   idle because the pane spinner changes.
4. **Uncommitted daemon-lib edits on main are restored.** handoffd's
   master-checkout-drift sweep logged `MASTER CHECKOUT DRIFT RESTORED:
   swarmforge/scripts/handoff_lib.bb` and put HEAD's copy back within one
   sweep (11:26:20Z, 11:28:10Z, 11:33:04Z), while the non-daemon
   `ready_for_next_task.bb` kept the matching edit. In that window the
   master checkout's ready_for_next called a print-task arity that did not
   exist. A hotfix that touches a daemon-executed file lands in one commit
   with its callers.
