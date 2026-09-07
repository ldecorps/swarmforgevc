# A land's BL-1438 repoint discards QA's own not-yet-landed bounce work — found verifying BL-1452, 2026-09-07

## Summary

`land_step_lib.bb`'s `post-land-repoint!` (BL-1438) runs `git reset --hard
origin/main` on the QA branch/worktree after every successful land. This
correctly resets the WIP the land itself produced (replay branches,
abandoned commits already pushed) — but it also silently discards any
OTHER local-only commits QA made that were never pushed to `origin/main`,
because a bounce is never pushed. Concretely: QA bounced BL-1450 this
session (`backlog/evidence/BL-1450-bounce-20260907.md`), reverted its
content out of the QA branch per BL-490/BL-495 (commit `d79f003542`), then
landed BL-1447 and ran the repoint. The repoint's `reset --hard
origin/main` discarded the revert (and the bounce evidence/bounce_history
commits sitting on top of it) along with everything else not yet on
`origin/main` at that point — the revert survives only in reflog and on
whatever branch happened to retain it (here, coincidentally, the coder's
own branch after merging QA's bounce). The next parcel's documenter tip
(BL-1452, built before the bounce) still carried BL-1450's original,
now-known-buggy content as an ancestor, and merging it back into the
freshly-repointed QA branch reintroduced that content with nothing left
to exclude it.

## Why this matters

This reopens BL-952/BL-1452's own hazard class one level up: not "a
bounced commit's approval status is wrong" but "a bounce's local-only
revert can be silently erased by unrelated later machinery, and the
bounced content can ride back in via any sibling ticket that shares
history with it, unless QA notices and re-verifies by hand every time."
The land-time entangled-sibling/passenger logic (BL-1375) is the actual
backstop — a genuinely unlanded sibling should still be excluded or
require verification when the NEXT ticket lands — but that logic keys on
ticket-level `human_approval`, not on whether the riding content was
itself QA-bounced. This session confirmed BL-1452 itself never touches
`bl968`'s file (so its own land should not need to carry it at all), but
a ticket that DID share a path with a bounced-but-approved sibling could
carry the bounced content through as a "passenger" without any check
catching it.

## Not blocking BL-1452

BL-1452's own commits never touch `extension/test/bl968MaterializedGuardSensitivity.property.test.js`
or any BL-1450 path (`git log origin/main..<tip> | grep BL-1452` filtered
commits' `diff-tree` names, empty for both). This finding is reported
separately, per the standing practice this session; BL-1452's own review
continues independently below.

## Recommendation

Either (a) `post-land-repoint!` preserve commits reachable from the
pre-reset QA tip that are not reachable from `origin/main` and not part of
what was just landed (a stash/cherry-pick before the reset), or (b) the
passenger/entangled-sibling check at land time additionally consult the
bounce stores (the same ones `is_qa_ancestor.sh` already reads) so a
sibling's bounced-but-not-yet-refixed content can never ride as a
passenger or land unexcluded. Sent as a `note` to the specifier; no ticket
minted by QA (specifier's call, Article 1.2).

By QA.
