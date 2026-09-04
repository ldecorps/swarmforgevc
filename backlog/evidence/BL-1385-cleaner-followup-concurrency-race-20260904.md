# BL-1385 follow-up — concurrency race in check_handler_module_graph.sh, found by cleaner while working an unrelated BL-1387 commit, 2026-09-04

Not a BL-1387 defect. Recorded here against BL-1385 (already forwarded past
cleaner, currently with architect or later) because that is the ticket the
guard belongs to.

## The finding

`check_handler_module_graph.sh` intermittently refused a commit on this
worktree with a large, VARYING count of "cannot load" handlers (519 on one
attempt, 530 on the next), then passed cleanly (exit 0) run standalone
seconds later with no source change in between.

## Reproduction

Two concurrent invocations of the unmodified script, same worktree, same
staged tree, no other change:

```
(bash swarmforge/scripts/check_handler_module_graph.sh > /tmp/run1.log 2>&1; echo "run1 exit $?" >> /tmp/run1.log) &
(bash swarmforge/scripts/check_handler_module_graph.sh > /tmp/run2.log 2>&1; echo "run2 exit $?" >> /tmp/run2.log) &
wait
```

Result: one run exits 0; the other exits 1 with `HANDLER_LOAD_BLOCK` /
"could not determine a tree to examine - refusing rather than passing an
unexamined tree".

## Cause (read from the script, not verified against a fix)

`check_handler_module_graph.sh`'s own header:

```bash
# BL-971: a killed run traps nothing, so sweep this prefix BEFORE the run too.
PREFIX="bl1385-handler-graph"
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
WORK="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")" || exit 2
```

The BL-971 sweep-before-mkdtemp pattern is safe for a single test fixture
run in isolation (which is where the codebase uses it elsewhere), but this
guard is invoked concurrently by design: it now runs on every commit
(`run_commit_guards.sh`) and every land (`land_step_lib.bb`) across every
worktree, and all of them share the same `TMPDIR`/`/tmp` and the same fixed
prefix. Two overlapping invocations race: one process's sweep glob-matches
and deletes the OTHER process's `WORK` directory (or its materialised tree
under it) mid-run, so requires that were about to resolve suddenly can't -
which is exactly the varying, large "cannot load" counts observed, not a
handler-specific problem.

## Impact

Since this guard is wired into BOTH the commit-time chain and the land
replay's tree-guard list, any two guard invocations overlapping ANYWHERE in
the swarm (any two worktrees committing or landing close together) can
intermittently and randomly refuse an unrelated, correct commit. The refusal
message looks like a real handler-load defect ("947 handlers, N unloadable")
which would misdirect whoever hits it into debugging their own change.

## Not this cleaner's fix to make

BL-1385 already passed cleaner and architect review before this was found.
Reported via a priority-00 note to the coordinator to route rather than
reworked here.

By cleaner.
