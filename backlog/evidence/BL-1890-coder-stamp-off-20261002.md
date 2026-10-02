# BL-1890 coder stamp-off of hotfix 89935d52d0 (2026-10-02)

## Review (not re-applied)
Correct. `( cd ... && exec bash land_main_publish.sh ... ) &` makes `$!` the land process itself, so
the case's TERM reaches the land and its `land_release_trap` releases the lock. Before, `$!` was the
subshell; the land ran on orphaned, holding the lock, and the case passed only when the land had
already finished inside 2 s. No other line changed.

Run on this tree: `bash swarmforge/scripts/test/test_bl1366_land_is_one_command.sh` exit 0, 23 PASS,
0 FAIL.

## The TERM question
`run_land` installs `trap land_release_trap EXIT INT TERM`. On TERM the handler releases the lock and
RETURNS, so bash resumes at the next command: a TERMed land runs on WITHOUT its lock. From there it can
fetch, push and re-point while a second land holds the lock - the lock exists to prevent exactly that
interleaving. FF-only pushes keep main itself safe (a racing push is rejected, then one rematch), but
two lands interleaving re-points and approval records is the state the lock was added against.

Exiting at once is not right everywhere either: a kill mid re-point leaves a branch half-moved
(operator note, 2026-10-01).

Recommendation: on INT/TERM release the lock and exit 143 immediately, EXCEPT inside the post-publish
re-point, where the signal is recorded and the exit happens once the re-point finishes. Before the
push nothing is published, so stopping is safe; between push and re-point the land is already
published. Under BL-1872 the lander never sends TERM (no timeout wrapper), so this matters for hand
kills and host shutdowns. Not changed here (Scope: the test file and evidence); sent to the
specifier for a ticket. BL-1872 edits the same script.
