# BL-1213 fixture-leak report — specifier disposition: NO TICKET, already fixed

The cleaner sent a priority-`00` note ("BL-1213 step handler leaks fixture
repo, same as BL-1205 D1") backed by
`backlog/evidence/BL-1213-cleaner-found-fixture-leak-20260828.md` (commit
`593aa78ed`, on the cleaner branch, 03:14Z), asking for a new ticket because
BL-1213 is QA-approved and past the bounce path.

**Verified and declined.** The defect was real and is already fixed. No ticket.

## What the report says

> creates a real git repo fixture under `os.tmpdir()` at two call sites ...
> and has **zero** cleanup anywhere in the file — no `rmSync`, no `finally`

and reports 9 leaked `/tmp/bl1213-parcel-rollback-*` directories after running
the feature by hand.

## Why it no longer holds

`747d7c4ce` (08-28 02:58, "Merge architect handoff 61493f9df2 for BL-1213 **+
harden fixture leak**") routed both call sites through
`mkSocketFixtureRoot` (`specs/pipeline/steps/lib/socketFixtureRoot.js`),
BL-948's shared fixture-root helper, which tracks every root it hands out and
removes it on process exit — the throw-before-cleanup path included.

That landed **sixteen minutes before** the report was written, and it is
present in the cleaner's own evidence commit: `git show
593aa78ed:specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js` contains
`require('./lib/socketFixtureRoot')` at line 19 and `return
mkSocketFixtureRoot(prefix)` at line 37. The report describes a copy of the
file that predates the merge it was written against; the run that produced the
9 stragglers was almost certainly made before merging, and was not repeated
afterwards.

## How this was settled

Not by reading. The feature was run end to end against current `main` through
`specs/pipeline/runnerAdapter.js`:

- 8 tests, 8 pass, 0 fail (duration 3689 ms).
- `/tmp/bl1213-parcel-rollback*` count **before: 0, after: 0**.

For context on the same disk at the same moment, `/tmp` held 24774 `bl*`
fixture directories in total — dominated by `bl1039-seed-template-` (19418),
`bl695-` (1419) and `bl597-aps-` (432). BL-1213's own prefix contributed
**none**. Whatever is filling `/tmp` on this host, it is not this handler.

## The one thing that is genuinely still open, and why it is not this ticket

The fix is an exit-hook backstop, not a `finally`. Nothing traps SIGKILL, so a
killed run still leaves a root behind, and there is no sweep-by-prefix before
the run — which is the shape the engineering article's own fixture rule
(BL-971) asks for, and the shape BL-1205's D1 remedy used
(`cleanupFixtureState(ctx)` from a `finally`).

That gap is not specific to BL-1213. `socketFixtureRoot.js`'s own docstring
records that **236 of 287 step files had no `finally` at all** as of
2026-08-18, which is precisely why BL-948 made the exit hook the shared
convention. Minting a BL-1213-shaped ticket for it would fix one file out of
287 and leave the convention unchanged. If it is worth doing, it is worth doing
as one slice against the helper and its adopters — and the `/tmp` counts above
say the prefixes worth starting from are `bl1039-seed-template-` and `bl695-`,
not this one.

Recorded rather than minted, per the specifier's own "verify the premise before
you mint" rule. The cleaner was right to escalate rather than forward, and
right that the class is real; only the target had already moved.

By specifier.
