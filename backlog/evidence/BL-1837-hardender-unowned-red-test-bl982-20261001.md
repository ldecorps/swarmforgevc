# Unowned red found while hardening BL-1837 (2026-10-01)

## Failing test

`swarmforge/scripts/test/test_bl982_multi_seat_identity.sh` case 7:
"single-seat pack provisions byte-identically to the pre-change script"

## Failure, verbatim

```
1,3c1,3
< specifier	master	ROOT	swarmforge-specifier	Specifier	claude	task	off	forward-only
< coder	coder	ROOT/.worktrees/coder	swarmforge-coder	Coder	claude	task	off	forward-only
< coordinator	master	ROOT	swarmforge-coordinator	Coordinator	claude	task	off	forward-only
---
> specifier	master	ROOT	swarmforge-specifier	Specifier	claude	task	off
> coder	coder	ROOT/.worktrees/coder	swarmforge-coder	Coder	claude	task	off
> coordinator	master	ROOT	swarmforge-coordinator	Coordinator	claude	task	off
FAIL: 7: single-seat roles.tsv changed shape vs pre-change script
```

## Cause

Case 7 diffs the CURRENT script's `roles.tsv` output against a script
pinned by blob sha (`2edd9a17ba9d40709c0f436d12395b638563c0ca`) - a
byte-for-byte comparison. Every row now carries a trailing `forward-only`
column (the reverse-hop pack-window field, commit `44d2d42591`), which
cannot appear in the pinned blob's output, so the diff always fails.

This is the EXACT symptom `BL-1489` ("the BL-982 single-seat handler
compares the fields it names", `backlog/done/`) already diagnosed and
fixed - but BL-1489's fix landed in the ACCEPTANCE step handler
(`bl982SecondSeatSteps.js` / a new `bl1489Bl982HandlerComparesNamedFieldsSteps.js`),
comparing only the fields the scenario names. This SEPARATE shell test
(`test_bl982_multi_seat_identity.sh`) still does the old strict
byte-for-byte diff and was not updated by that fix, so it fails on the
identical column-addition BL-1489 already named.

## Not this parcel's

BL-1837's own commit (`71e01ca58b`) touches zero lines of
`write_roles_file` or anything that shapes `roles.tsv` - confirmed by
`git show 71e01ca58b --stat` (no match) and by reproducing the identical
failure on the unrelated `main` worktree checkout (`/home/carillon/swarmforgevc`,
branch `main`), with none of this session's commits present.

`backlog/standing-reds.tsv` carries no row for this file/case as of
2026-10-01 (grepped clean before this note). Reported as an unowned-red
note (priority 00) to the specifier per the standing-red rule; BL-1837's
own hardening continues separately (own risk area: `role_prompt_card_path`'s
`${role//@/-}` global replace, checked and found equivalent to a
first-occurrence-only replace since `parse_config` itself refuses any
seat id carrying more than one "@" - see the property test's own comment,
`extension/test/bl1837LocalSeatCardPathInvariants.property.test.js`).

By hardener.
