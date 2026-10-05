# BL-1991 coder evidence: replay against the real session (2026-10-05)

qa_e2e_procedure step 3 asks for the restart decision replayed against
session `72f67fe0-cfdb-4072-8fa6-72ecbd998241`'s real transcript
(`~/.qwen/projects/-home-carillon-swarmforgevc--worktrees-coder/chats/`),
confirming it fires on the third non-write call after a compaction naming
`bl1928SeatToolingFromOriginMainSteps.js`.

Read-only replay (no write to the real transcript, no state touched under
this checkout's `.swarmforge/`): for each prefix of the real transcript,
parsed the entries with the production `transcript-entries` and asked
`restart-decision` whether the call that is last in that prefix should
restart the seat, starting from `restart-count 0` (this session never
actually restarted, so there is nothing to subtract).

Result: `restart-decision` first returns non-nil at transcript line 401 -
the 99th call recorded in the session - a `read_file` of
`swarmforge/scripts/swarmforge.sh` at offset 1505. `calls-since-compaction`
at that point holds exactly 3 entries, all `read_file` calls over the same
file at increasing offsets, none of them a write of
`specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js` - the path
the latest compaction's `<next_step>` names. The decision's own `:path`
matches that file exactly.

This matches the procedure's claim: the restart fires on the third
non-write call since the latest compaction naming that write, against the
real failure this ticket's trial was built from - not only the synthetic
fixtures `bl1991SkippedWriteRestartSteps.js` drives.

(The replay script continues past the first restart and finds a second
"restart" at line 402; that is an artifact of the script never resetting
the prefix to a fresh transcript after a restart - a real seat's qwen
process would already have been ended and a fresh turn started by then.
The step handler's own acceptance scenarios, not this ad hoc replay, are
what prove the reset-on-restart behavior.)
