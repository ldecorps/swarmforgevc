# Unowned red: swarmforge/scripts/test/test_bl1388_land_step_guard_fixture.sh

Found while processing a QA merge-up note for BL-1513 (unrelated to this
red) - re-ran the shell tests in the `land_step` neighborhood after
restoring an unrelated silently-reverted merge artifact in
`land_step_cli.bb` (see the untagged repair commit immediately prior to
this evidence file, same session).

## Failure

`bash swarmforge/scripts/test/test_bl1388_land_step_guard_fixture.sh` on
this worktree (cleaner, tip after the merge-up):

```
FAIL: the diff touches assertions outside the fixture block (0 lines)
```

## Confirmed pre-existing on main, not caused by this worktree's work

Fresh clone of `main` (`b1e8ba48bd`, `git clone` under `/tmp`, no worktree
state involved) reproduces the same failure, plus additional failures not
seen on this worktree's own run:

```
FAIL: the runner is still red (rc=1): FAIL: BL-1375: an all-approved shared path plans a replay, not an escalation
FAIL: BL-1375: and the plan names the passengers riding on it
FAIL: the refusal case passes whatever the handler is named (rc=1)
PASS: the block still calls run-replayed-tree-guards with no injected tree-guards-fn
PASS: and still assesses a non-main tree (the land-replay branch)
FAIL: the diff touches assertions outside the fixture block (0 lines)
PASS: the empty-array tree is pinned as PASSING, the premise BL-1371 established
```

The common failure (`the diff touches assertions outside the fixture
block (0 lines)`) comes from the test's own step 4
(`swarmforge/scripts/test/test_bl1388_land_step_guard_fixture.sh:76-87`):
it asserts `git diff main -- swarmforge/scripts/test/land_step_lib_test_runner.bb`
is non-empty (BL-1388's own fixture block should show as a diff against
`main`). Since BL-1388 has since landed on `main` itself, that file is now
byte-identical to `main` there, so `changed=0` and the assertion that
`changed > 0` fails unconditionally - a self-defeating check once its own
target ticket ships. The extra BL-1375 failures on the fresh clone (absent
on this worktree's run) suggest a second, environment-sensitive issue in
that same runner, not investigated further here - out of scope for BL-1513
and not this worktree's own ticket.

## Not this worktree's own defect

Reproduces identically on a fresh `main` clone with none of this session's
own commits present. Nothing this worktree changed (BL-1609/1611/1612/
1513/1618 review passes, or the `land_step_cli.bb` merge-revert repair)
touches `test_bl1388_land_step_guard_fixture.sh` or
`land_step_lib_test_runner.bb`.

By cleaner.
