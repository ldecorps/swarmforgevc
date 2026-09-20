# Unowned red: test_merge_deletion_guard.sh case 09 fixture trips check_closed_ticket_subject.sh's ambiguous-subject check

Found while reviewing BL-1662 (cleaner pass). BL-1662 does not touch
`swarmforge/scripts/test/test_merge_deletion_guard.sh` — confirmed
pre-existing by temporarily restoring `check_merge_deletion.sh` to its
pre-BL-1662 content and re-running: same failure, same output.

## Failing command

```
bash swarmforge/scripts/test/test_merge_deletion_guard.sh
```

Exit 1. Output stops after `PASS: 08` with no PASS/FAIL line for case 09:

```
check_closed_ticket_subject: WARNING - could not read origin/main's backlog/ tree; not checking BL-0003.
check_closed_ticket_subject: WARNING - could not read origin/main's backlog/ tree; not checking BL-0004.
Error: commit subject names several ticket ids (BL-0003 BL-0004) and leads with none - the land step reads this AMBIGUOUS and every named id rides as an owner (BL-1544).
Commit rejected: lead the subject with the open ticket that owns this work, e.g. "BL-0003: ...".
```

## Root cause

`core.hooksPath` is configured for the fixture root ahead of case 07 (line
193), so every commit made in the fixture from case 07 onward runs
through the full installed hook chain, including
`check_closed_ticket_subject.sh`'s own BL-1544 ambiguous-subject check.
Case 09's own setup commits, at line 224:

```
git -C "$ROOT" commit -q -m "revert BL-0003/BL-0004 bounce"
```

names two ticket ids in its subject with no leading id — exactly the
shape `check_closed_ticket_subject.sh` refuses as AMBIGUOUS. The script
has `set -e`-adjacent flow (the commit is not wrapped in `set +e`/`set -e`
the way the merges at lines 196/226 are), so this commit itself aborts
the whole test script.

## Failure class

behavior (test fixture, not production code)

## Expected vs observed

Expected: case 09's setup commits succeed and the case exercises the two
merge-deletion guards it names (`check_ticket_deletion.sh`,
`check_merge_deletion.sh`). Observed: the setup commit itself is refused
by an unrelated third guard (`check_closed_ticket_subject.sh`'s
ambiguous-subject sub-check, BL-1544/BL-1617) that the fixture's own
subject text was never written to satisfy.

## Not fixed here

Outside BL-1662's domain — BL-1662 touches only
`check_merge_deletion.sh`, BL-1242's feature/handler, and the fixture CLI
(`bl1242MergeBranchWorkDeletionCli.sh`), never
`test_merge_deletion_guard.sh`. A likely remedy: lead the case-09 setup
commit's subject with one of the two ticket ids (e.g. `"BL-0003:
revert BL-0003/BL-0004 bounce"`), or wrap it the same way the merge
attempts at lines 196/226 are wrapped (`set +e`/`set -e`) if the ambiguous
subject is itself part of what the case means to exercise.

By cleaner.
