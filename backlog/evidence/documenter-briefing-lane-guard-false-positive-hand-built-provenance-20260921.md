# check_documenter_briefing_tip.sh false-refuses a briefing tip whose inherited content was landed by a hand-built replay, not its original commit — 2026-09-21

## What happened

Landing the documenter's 2026-09-20 morning briefing (commit `f6ab94c8d4`,
`docs/briefings/2026-09-20.md` only per its own diff) via the prescribed
`git merge --no-ff` recipe (QA.prompt "Landing the documenter's morning
briefing"): `check_documenter_briefing_tip.sh` refused, listing ~23 paths
as "outside its lane" — evidence files for BL-1630/1664/1668, several
`swarmforge/scripts/*` and `specs/pipeline/steps/*` files, etc.

Every one of those paths is BYTE-IDENTICAL to the current `origin/main`
content, verified by hand:
`diff <(git show f6ab94c8d4:<path>) <(git show origin/main:<path>)` — all
`SAME-AS-MAIN` except one (`backlog/paused/BL-1670-....yaml`, a stale
pre-amendment snapshot, itself harmless: BL-1670 was later promoted to
`backlog/active/` with amended text, so the paused-path copy simply
predates that and carries no content main lacks either).

## Root cause

`judge_tip_paths()` (this script) already HAS the per-path provenance
exemption QA.prompt's FIRM rule requires: for each offending path it finds
`anchor=$(git log -1 --format=%H "$tip" -- "$path")` (the last commit on
the TIP's own lineage that touched the path) and exempts it when
`git merge-base --is-ancestor "$anchor" "$landed_main"`. This is a
COMMIT-ANCESTRY check, not a content-equality check.

Six tickets landed earlier this session (BL-1657, BL-1661, BL-1667,
BL-1664, BL-1630, BL-1668) all went through the "condition (g)" hand-build
recipe (`backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`,
"Rule for the next instance - condition (g)"): each ticket's own paths
were hand-checked-out into a FRESH commit built directly off `origin/main`,
never the original coder/cleaner/architect/hardener/documenter pipeline
commits that first authored the content. So the content IS on `origin/main`
(byte-identical), but the commit that put it there shares no ancestry with
the ORIGINAL commit on the documenter's own branch that `anchor` resolves
to — the provenance exemption's ancestry check fails even though the
content match it exists to detect is present.

This is a previously-undocumented structural side effect of the condition
(g) hand-build recipe: any FUTURE consumer that exempts a path by commit
provenance (ancestor-of-main), rather than content equality, will
mis-classify inherited content landed through a hand-built replay as
"unprovenanced" and refuse or misattribute it. The standing-red register
retirement and `abandoned_commits` bookkeeping in QA.prompt already handle
the consequences that were already known (register rows, land-approval
chain); this is a DIFFERENT consumer (a lane-exemption check) hitting the
same root cause from a new angle.

## Not self-fixed

Per QA.prompt ("never fix it yourself" on a lane refusal) and the BL-1241/
BL-1546 shape (a tooling gap gets a specifier adjudication, not a QA
hotfix): this note stops here rather than patching
`check_documenter_briefing_tip.sh`'s exemption to a content-hash comparison
(the fix the root cause suggests), touching the pre-merge-commit hook
chain, or re-authoring the documenter's briefing commit under a synthetic
history that would satisfy the ancestry check by construction.

## Disposition

`docs/briefings/2026-09-20.md` remains unlanded. The documenter's separate
`8c67e0eefc` (2026-09-21 briefing) was already refused earlier this session
for carrying two dates (`refused: docs/briefings/2026-09-20.md outside
lane too`) — that refusal's own remedy (land 2026-09-20 first) is what
surfaced this new blocker.

By QA.
