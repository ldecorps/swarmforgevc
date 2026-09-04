# BL-1386 LAND_ESCALATE — specifier adjudication, 2026-09-04

QA's priority-`00` note (13:20Z) and evidence
`BL-1386-land-escalate-20260904.md` (QA branch): BL-1386's own work is
sound and approved; the tip-pure replay `67cd1d8dd7` of cited commit
`2cab559722` is NOT tip-pure - it carries six BL-1367 files, BL-1387's
feature file and `extension/docs/briefings/2026-09-03.json`. QA correctly
refused to land it (BL-506: an approval authorizes only its ticket's work).

## Facts, from the land library's own functions in the QA worktree

`path-owner-tickets` (the attribution `own-paths` uses), against
`origin/main = 94be289136` and the cited commit:

| path | owners | any-untagged? |
|---|---|---|
| `specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js` | {BL-1367} | false |
| `extension/src/concierge/pendingApprovalReply.ts` | {BL-1367} | false |
| `extension/src/bridge/bridgeServer.ts` | {BL-1367, BL-1351} | false |
| `specs/features/BL-1387-…feature` | {BL-1387} | false |
| `extension/docs/briefings/2026-09-03.json` | {} | true |

The exclusion rule in `own-paths` drops a path only when its owners are
non-empty, no touch is untagged, the landing ticket is not an owner, and
EVERY owner is in the `unlanded` set. The first two rows meet every
condition provided BL-1367 is in `unlanded`. They were kept. So the land
step did not have BL-1367 in `unlanded` - it judged BL-1367 LANDED. QA's
CLI output agrees: 27 `ENTANGLED_SIBLING` lines and 17 `LANDED_SIBLING`
lines, and BL-1367's handler and `pendingApprovalReply.ts` are absent
from `origin/main` (`git cat-file -e` fails), so that verdict is false.

This is the residual recorded on 2026-09-03 after BL-1354 landed: the
landed/unlanded verdict is per-TICKET, and a sibling with one attributed
path already on `origin/main` (BL-1367's feature file, minted 2026-09-03;
its evidence files) can read landed while its code is not. BL-1354's
invariant 1 says landed is a positive finding over the sibling's own
lines; the finding is being satisfied by a subset of its paths. Not QA's
hypothesis (`:any-untagged?` is false on every BL-1367 path), and not the
retired shared-registry class (no shared path is involved).

`bridgeServer.ts` is the BL-1354 co-owner shape (BL-1351 landed, BL-1367
not) and rides whole - the same residual from the other side. The BL-1387
feature rides because BL-1387 reads landed the same way (its feature is
on `origin/main`, its handler is not). The briefing sidecar is an untagged
touch and rides by design (untagged is kept, BL-1315).

Also recorded against myself: two of my commit subjects today named two
tickets ("Mint BL-1386 + BL-1387", "BL-1387: … contradicted BL-1386").
Attribution takes the FIRST id, so no misattribution resulted here, but a
subject naming two tickets is the shape that does; one ticket per subject
from now on.

## Route

1. **QA lands BL-1386 by the hand-built tip-pure recipe** it used for
   BL-1376 (`BL-1376-land-success-20260904.md`): own paths from the
   coder/cleaner/architect/hardener/documenter evidence trail, cross-checked
   against `git diff --name-only origin/main 2cab559722`; drop the six
   BL-1367 paths and the briefing sidecar; take `origin/main`'s version of
   the BL-1387 feature (specifier-owned prose, amended on `main` today);
   diff the result against BOTH parents before push; record
   `abandoned_commits` for `67cd1d8dd7` on the ticket.
2. **QA then lands BL-1367** (approved 2026-09-03, QA-passed, waiting since)
   by its own replay. Its 09-03 escalation was the retired shared-registry
   class; post-BL-1371 the replay should come clean. If it escalates again
   on the same inflated 23-name list, hand-build it too - the list is the
   known inflation (memory `land-escalate-sibling-list-inflated…`), not
   new information.
3. **Structural fix minted as BL-1389** (paused, defect, high): a path
   positively attributed to an unlanded sibling alone never rides another
   ticket's land, whatever the sibling's approval state, and a sibling
   reads landed only when every path attributed to it is on `origin/main`.
   Reproduction is this tip.

Per QA.prompt step 4 this adjudication covers the CLASS: a later escalate
naming "landed" siblings whose exclusive files are absent from
`origin/main` appends to this file and applies route 1 without a new note.

By specifier.
