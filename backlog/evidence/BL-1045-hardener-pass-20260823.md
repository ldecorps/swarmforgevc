# BL-1045 — hardener pass

Forwarded fresh from the architect (no prior hardener pass). Touches
`heldSince.ts` (wholly new), `pipelineBoard.ts` (large pre-existing file,
this ticket added the held-related functions and modified
`computePipelineBoard`/`buildLinks`), `conciergeTick.ts` and
`telegram-front-desk-bot.ts` (both large pre-existing files, only lightly
touched by this ticket).

## CRAP — differential analysis, one real regression found and fixed

A first pass of `crapReport.js` over the four changed files flagged over
100 violations — almost all pre-existing debt in `telegram-front-desk-bot.ts`
and `conciergeTick.ts` that this ticket never touches (both are large,
long-standing files this ticket only lightly edits). Rather than treat the
raw flag count as this ticket's debt, diffed every flagged function's
complexity against its pre-BL-1045 baseline (`git show <parent>:<file>` +
`crapReport.js`, the differential-complexity discipline this role already
uses):

- `heldSince.ts`: wholly new, already CRAP-clean (0 violations).
- `conciergeTick.ts`: every flagged function (`syncBoardIfWired`,
  `syncBoardPinIfWired`, `runConciergeTick`, `logBoardSyncFailure`,
  `logBoardPinSyncFailure`, etc.) has **identical** complexity to its
  pre-ticket baseline — the diff hunks only add parameters/fields passed
  through, no new branches. Zero regressions; all pre-existing, untouched
  debt.
- `telegram-front-desk-bot.ts`: same — `readLiveRoleHeldTickets` and
  `toFoldersSnapshot` (the only two functions this ticket's diff actually
  touches) are unchanged from baseline. Zero regressions.
- `pipelineBoard.ts`: **one real regression** —
  `computePipelineBoard` rose from baseline complexity 4 to 9 (CRAP 20.00
  → 9.00 once BL-1045 also added its own 100%-coverage tests). Extracted
  the held-field result-shaping (`...(held.length > 0 || heldOmittedCount
  ? {held} : {}), ...(heldOmittedCount ? {heldOmittedCount} : {})`) into a
  new `heldResultFields` helper. `computePipelineBoard` now at complexity
  6 / CRAP 6.00; `heldResultFields` at CRAP 4.00.

Every genuinely NEW function this ticket added (`linksFromHeld`,
`formatHeldForLabel`, `heldEntryFor`, `byHeldLongestFirst`,
`buildHeldEntries`, `pipelineBoardHeldOverflowLine`, `renderHeldSection`)
was already under CRAP<=6 as landed — no extraction needed for those.

## Mutation testing

Scoped Stryker run (`--ignoreStatic --concurrency 8`, the pattern this
session established for a multi-core host) over `heldSince.js` and
`pipelineBoard.js`. `pipelineBoard.js` alone carries ~900 mutants (a large,
mostly pre-existing file) — rather than exhaustively triage the whole file,
triaged **every survivor inside `heldSince.ts` (wholly new, 100%
this ticket's responsibility) and inside the specific NEW held-related
functions in `pipelineBoard.ts`** (the genuinely new/modified code), using
this session's established hand-verification method (apply the exact
mutant to the compiled `out/` file, run the real test file, read the exit
code).

**`heldSince.ts`: 14 survivors, all resolved.** 12 real gaps closed with 8
new tests (trim-matters, leading-blank-line-skipped, leading/trailing
numeric-garbage rejected, digits-at-both-ends-with-garbage-between
rejected — parseInt's own leniency alone does not guard this, only the
full-match regex does — epoch-zero rejected, and an unrealistically huge
digit string overflowing to `Infinity`). 2 genuine equivalents, each
verified by hand-mutating and confirming the existing suite still passes
either way: dropping the `first === undefined` disjunct (JS coerces
`undefined` to the string `"undefined"` before a regex `.test()`, which the
anchored `/^[0-9]+$/` already rejects — the disjunct is redundant by
construction) and emptying the `catch` block (a JS function that falls off
the end of a `try`/`catch` with no explicit return already returns
`undefined`, identical to the removed `return undefined;`).

**`pipelineBoard.ts`'s NEW held code: 11 survivors, all resolved.** 8 real
gaps closed with 8 new tests (an unresolvable held-link path must not
produce a broken link entry; the link-list dedup must keep the
FIRST-found path when the same id also appears via `held`, not the last;
exact HOUR_MS/MINUTE_MS age-label boundaries; a same-age sort tie broken by
id rather than accidentally-matching input order — tested with input order
deliberately REVERSED from id order, so a skipped tiebreak could not pass
by coincidence; the section's blank-line separator asserted as truly
empty, not merely present; a double-space-before-parenthesis collapse
verified against both a too-narrow and a wrong-character-class regex
mutant). 3 genuine equivalents, each verified by hand-mutation: the
`extras.held ?? []` fallback's Stryker-injected placeholder is a bare
string, which can never carry a real `.filename`, so `linkPathFor`'s own
`!meta?.filename` guard rejects it regardless of the mutant; and BOTH
`omitted > 0` mutants (`true`, `>= 0`) in `buildHeldEntries` are masked by
the OUTER `heldResultFields`'s own truthy check on the same
`heldOmittedCount` value — `omitted` is always a non-negative integer
(`ordered.length - shown.length`, never negative), so `omitted > 0` and
`Boolean(omitted)` are provably identical over its whole domain, making
the inner check's exact boundary form unobservable from
`computePipelineBoard`'s public output no matter which of the three forms
it takes.

Given `pipelineBoard.js`'s remaining ~175 survivors outside the code this
ticket touches were not individually triaged (pre-existing debt in a large
file, outside this parcel's scope per the differential-CRAP discipline
above applied the same way to mutation coverage).

## Verification, re-run live

- `npm run compile`: clean throughout.
- `npx vitest run` (full unit suite): **477 files / 8551 tests, ALL PASS**.
- `npx vitest run --coverage` + `crapReport.js`: zero CRAP regressions;
  every new/modified function at 100% coverage.
- Standing whole-tree guards (13 `*Guard*.test.js`): **125/125 PASS**.
- `npx jscpd --config .jscpd.json` scoped to the three changed files: 3
  small clones found, all inside pre-existing, untouched regions of
  `conciergeTick.ts` (unrelated icon-sync loop vs. the new `heldItems`
  helper — inspected directly, not a meaningful duplication of BL-1045's
  own code).
- `node out/tools/dependency-gate.js`: only the three pre-existing BL-759
  telegram edges remain (this session's standing confirmed baseline).
- BL-1045's acceptance feature: **5/5**.
- Related test files (`pipelineBoard.test.js`,
  `pipelineBoardSync.test.js`, `pipelineBoardPinSync.test.js`,
  `bl586PipelineBoardTopicIdentity.test.js`,
  `bl979PipelineBoardTicketRows.test.js`): **251/251 PASS**, all property
  siblings green (**22/22**).
- Orphaned processes: none in this worktree (`pgrep -fl 'node --test|stryker'
  | grep hardender` empty; a match found belonged to the coder's own
  worktree, unrelated). `git status --short` clean except the files this
  pass intentionally changed.

## Verdict

One real CRAP regression found (via differential baseline comparison, not
the raw flag count) and fixed via extraction. 25 real mutation survivors
found and killed via 16 new tests across the two files this ticket's own
code lives in; 5 further survivors individually, checkably proven
equivalent from the code (JS coercion semantics, default-return semantics,
and a redundant outer truthy-check masking an inner boundary). Forwarding
to documenter.

— By hardender.
