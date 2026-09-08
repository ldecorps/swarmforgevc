# BL-1466's bounce check reads the wrong root by default and is silently inert — found verifying BL-1463, 2026-09-07

## Summary

`land_step_lib.bb`'s `bounce-blocking-state` (BL-1466, landed today as
`2a26088404`/`b84c4ae9e3`) is logically correct but reads
`.swarmforge/bounces/<YYYY-MM>.jsonl` from whatever `root` its caller
passes — and `land_step_cli.bb`'s default root resolution
(`resolve-repo-root`, `git rev-parse --show-toplevel`) resolves to the
**calling worktree**, never the shared master checkout. `record-bounce.js`
(the tool that writes bounce records) writes to the **shared master
checkout's** `.swarmforge/bounces/`, confirmed directly:
`/home/carillon/swarmforgevc/.swarmforge/bounces/2026-09.jsonl` (not
`/home/carillon/swarmforgevc/.worktrees/QA/.swarmforge/bounces/`, which
does not exist). Every ordinary land-time invocation — `land_step_cli.bb
<task> <commit>` with no explicit third argument, exactly how this
session (and, by the same default, every other QA session) has run it all
day, and how `land_main_publish.sh`'s own `--land` mode calls it
internally — resolves the wrong root and silently finds "no bounce record
exists" for a genuinely, recently bounced sibling.

## How found and confirmed

Verifying BL-1463 (an unrelated, correctly-implemented land-step ticket)
today, `land_step_cli.bb BL-1463 3bc36c000f` printed `ENTANGLED_SIBLING
BL-1348` for a ticket this session bounced hours earlier
(`backlog/evidence/BL-1348-bounce-20260907.md`, commit `3b16f8c73c`).
Suspecting this was BL-1466's own new protection working correctly, I
checked directly:

```
$ bb -e '(load-file "land_step_lib.bb")
          (println (land-step-lib/bounce-blocking-state "." "BL-1348" "3bc36c000f"))'
nil                                                    ; wrong root - silently finds nothing

$ bb -e '(load-file "land_step_lib.bb")
          (println (land-step-lib/bounce-blocking-state "/home/carillon/swarmforgevc" "BL-1348" "3bc36c000f"))'
{:state :bounced, :blocking? true, :reason "BL-1348 bounced 2026-09-07T16:13:29.319Z at 3b16f8c73c, not re-fixed"}
```

The `ENTANGLED_SIBLING BL-1348` I actually observed came from the
PRE-EXISTING, independent unlanded-commit detection (BL-1348's real coder/
cleaner/architect/hardener/documenter commits are genuinely unlanded,
regardless of any bounce) — not from BL-1466's bounce check, which never
fired. BL-1348 happens to be blocked correctly here for an unrelated
reason; a ticket that were APPROVED, UNLANDED, but sharing only a PASSIVE
path (the exact passenger shape BL-1375/BL-1466 exist to gate) would ride
straight through with no bounce ever consulted.

## Why this matters

This silently reopens the exact hazard BL-1466 was minted to close
(`backlog/evidence/BL-1452-QA-followup-repoint-discards-unlanded-bounce-work-20260907.md`):
a bounced-but-not-yet-refixed sibling's content can ride as an approved
passenger into another ticket's land, because the one check meant to catch
it never reads the store that actually has the record. `is_qa_ancestor.sh`
avoids this class of bug for the SEPARATE land-approvals store (BL-1339,
human ruling) by resolving from `git rev-parse --git-common-dir`'s parent
(the shared root) rather than the caller's own directory — but its own
comment states bounce stores were DELIBERATELY left on the caller's
directory ("moving them is ruling option 3 and its own ticket"), which
`land_step_lib.bb`'s new BL-1466 reader inherited without adjustment.

## Not a defect in BL-1463

Confirmed BL-1463's own land is unaffected: BL-1348's genuinely unlanded
content is still correctly excluded from BL-1463's replay via the
independent, unrelated commit-attribution walk (verified byte-identical
in `backlog/evidence/BL-1463-QA-20260907.md`). This finding is about
BL-1466's own bounce-specific check being unreachable in practice, a
separate concern from BL-1463's own correctness.

## Recommendation

Either (a) `bounces-dir` resolve from the shared root the same way
`is_qa_ancestor.sh` resolves `LAND_ROOT` (`git rev-parse
--git-common-dir`'s parent), overriding the "caller's own directory"
posture that ruling deliberately chose for a different store, or (b)
`land_step_cli.bb`'s default root resolution itself target the shared
root rather than `git rev-parse --show-toplevel`, if every land-time
concern (not just bounces) is meant to read from there. Given
`land_main_publish.sh` already targets the shared root when acquiring the
land lock and pushing, option (b) may be the more consistent fix. Sent as
a `note` to the specifier; no ticket minted by QA (specifier's call,
Article 1.2).

By QA.
