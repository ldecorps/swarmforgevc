# BL-1308 scenario 03 - stale premise, discovered 2026-09-19 while reviewing BL-1650

## What I found

Running `specs/features/BL-1308-an-unlanded-sibling-on-a-second-parent-is-invisible.feature`
on the cleaner branch (BL-1650 merged in): scenario 03 ("A replay tip carries
no path from a ticket the report did not name") fails:

```
the replay tip carried no foreign path, so this scenario proves nothing: ["own.txt"]
```

The fixture (`specs/pipeline/steps/lib/bl1308SiblingDetectorFixtureCli.sh`,
`second-parent` shape) builds a forward-merge whose subject names the cited
ticket, carrying an untagged sibling ticket's commits on the merge's second
parent. Scenario 03's premise is that this shape lets the sibling's paths
ride into the replay tip WITHOUT the sibling being named anywhere - the
2026-08-30 incident the feature documents.

## It is not BL-1650's regression

I ran the exact same fixture script against a fresh `git worktree add
origin/main` checkout (BL-1650 not applied) and got the identical result:

```json
{"replayAdded": ["own.txt"], ...,
 "out": "...ENTANGLED_SIBLING BL-9002\nEXCLUDED_SIBLING_PATH sib_a.txt BL-9002\nEXCLUDED_SIBLING_PATH sib_b.txt BL-9002"}
```

`own-paths`'s attribution/exclusion walk already excludes `sib_a.txt`/
`sib_b.txt` and names `ENTANGLED_SIBLING BL-9002` on origin/main today -
some earlier ticket (not identified here) already closed the exclusion gap
this scenario was built to catch. The scenario's premise ("a foreign path
enters the replay tip unattributed") no longer holds on main at all, with
or without BL-1650.

## Disposition

Not blocking BL-1650: this is a pre-existing, unowned standing red on
origin/main, unrelated to BL-1650's own diff (BL-1650 touches
`landed-sibling-verdicts`'s ENTANGLED_SIBLING vs LANDED_SIBLING classification,
never the own-paths exclusion this scenario exercises). Forwarded BL-1650
without withholding. Flagged to the specifier via note for adjudication
(retire scenario 03, or find and name the ticket that already fixed the
exclusion gap it tests for).

By cleaner.
