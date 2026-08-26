# BL-684 — architect SEND BACK: dated records had their original prose rewritten

**Parcel:** cleaner commit `49b89435de` (residual-files allowlist dedupe), full chain
reviewed back through coder's original rename `d3474a052`.

**Verdict:** SEND BACK to coder.

## Defect — two dated historical records had "facilitator" silently rewritten to "onboarder", falsifying what was actually written at the time

The ticket's invariant 3 states: "The dated audit trail is byte-identical... a record
keeps the words that were actually used when it was written." The coder's own
regression test (`extension/test/onboarderRenameNoResidualFacilitator.test.js`)
already extends this exact rationale, in its own comment, to `docs/briefings/` as a
whole EXEMPT prefix:

> docs/briefings/ (dated generated reports - the same "a record keeps the words
> that were actually used when it was written" rationale; a NEW dated file
> appears on every future run and a hardcoded per-date whitelist entry would go
> stale by tomorrow).

But commit `d3474a052` (the original rename) contradicts its own stated policy.

### Site 1: docs/briefings/2026-07-26.md

```diff
-1. Unpark BL-590 (conditions met) — after BL-647/648 land, so the facilitator
+1. Unpark BL-590 (conditions met) — after BL-647/648 land, so the onboarder
    re-cut rides a pipeline that no longer loops or starves on relaunch.
```

This briefing is dated 2026-07-26 — the day *before* this rename landed — and the
line records what was actually recommended at that time, in the vocabulary in use
at that time. Rewriting it makes the dated record say something it never said,
exactly the harm invariant 3 exists to prevent, and exactly the class the coder's
own test comment already carves out this whole directory to avoid. (Today's
briefing, `docs/briefings/2026-07-27.md`, was correctly left untouched and still
says "facilitator" — so the sweep did apply this exemption inconsistently, not
uniformly wrong.)

### Site 2: docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md

```diff
-#1  un-guarded durable writes in the facilitator turn      "guard this branch"
+#1  un-guarded durable writes in the onboarder turn      "guard this branch"
```

Worse than site 1: this line is a verbatim quotation of a sequence of real
architect send-back comments from an incident dated 2026-07-25. "Onboarder" did
not exist as a word in this codebase on 2026-07-25 — no reviewer ever wrote "the
onboarder turn." The rewrite makes an incident retrospective misrepresent its own
history. This file isn't in the `docs/briefings/` exempt prefix and isn't in
`ALLOWED_RESIDUAL_FILES`, so the coder's own regression test would have failed
had the word been left in place — the test's existence is *why* this site was
swept, not a check that would have caught it.

Both sites are the same defect class: a dated record's original-vocabulary content
was swept by the rename instead of preserved, contradicting a principle the ticket
already correctly applies to `backlog/evidence/`, `backlog/done/`,
`backlog/topics/*.json` (specifier's addition), and — by the coder's own test
comment — `docs/briefings/` itself.

### Remediation

1. Revert both lines to their original "facilitator" wording — `docs/briefings/2026-07-26.md`
   and `docs/explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md`.
2. Swept the rest of `docs/` for the same class myself and found no other site:
   `docs/briefings/2026-07-27.md` (today's, untouched, correct) is the only other
   dated-briefing hit, and no other `docs/explanation/lessons-*` file mentions the
   word. These two sites are the complete list.
3. The regression test currently only asserts "facilitator" doesn't appear outside
   the allowlist/exempt-prefix — it has no assertion that a dated file's *original*
   wording survives verbatim, so nothing will catch a recurrence of this class
   automatically. Flagging for awareness; not itself grounds to bounce further.

## What is NOT the problem (do not over-correct)

- **Dependency-rule hard gate PASSED** — ran both the extension-relative changed-file
  scan (`onboarderState.ts`, `onboarderStateStore.ts`, `onboarder-reconcile.ts`,
  `telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`) and a full-repo scan. No forbidden edges either way.
- **Co-change report**: every pairing across the ticket's changed files sits at
  1-2 occurrences, below the default frequency-3 threshold — noise from this
  ticket's own commits, not a logical-coupling finding.
- **All three declared invariants have real, non-vacuous property tests**
  (`onboarderRenamedPathsResolve.property.test.js`,
  `onboarderLauncherPidGuard.property.test.js`,
  `onboarderEvidenceByteIdentical.property.test.js`). Spot-checked invariant 3's
  test independently: recomputed sha256 of three of its protected files against
  the live filesystem, all matched its baked-in hashes; confirmed no
  `backlog/evidence/` or `backlog/done/` file appears anywhere in the whole
  BL-684 diff range except the new (additive-only) QA bounce evidence file
  itself. Invariant 2's test exercises the real `launch_onboarder.sh` against
  real spawned live/dead processes, not a mock.
- **Filename history is intact.** `onboarderStateStore.test.js` and
  `onboarderReconcileCli.test.js` show as plain delete+add rather than a
  detected rename when diffing the ticket's base against current HEAD — but
  `git log --follow` on both correctly walks back through the pre-rename
  history. The original rename commit (`d3474a052`) did a clean small-diff
  rename; the *later* hardener pass grew each file enough (54→161 lines,
  107→278 lines) that the squashed base-to-HEAD comparison alone falls under
  git's similarity threshold. Not a defect — checked the actual rename commit's
  own diff, not just the endpoint comparison.
- **required_wiring verified**: `start_ancillary_services.sh` calls
  `launch_onboarder.sh`; `stop_ancillary_services.sh` clears artifacts under
  both old- and new-named paths.
- **Invariant 2 verified in the source**: `launch_onboarder.sh` declines (exit 0,
  prints why) and never adopts/kills/migrates when the old-named pid file holds
  a live pid; the noted dryrun-vs-guard-ordering snag from the ticket's own
  `notes:` didn't need fixing because the property test exercises the guard
  directly against a real fixture, never through dryrun mode.
- **Telegram files** (`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`) show pure vocabulary renames only — no behavior
  change, matching the ticket's own out-of-scope clause.

## Bounce hygiene

Reverted my own review-merge (`6edcfbd0c`, cleaner's `49b89435de` merged into
`swarmforge-architect`) via `git revert -m 1` per BL-490/BL-495 — confirmed
`git diff --name-only <prior-tip> HEAD` is empty (bounced content fully absent
from my tree). Confirmed not on `main`
(`git merge-base --is-ancestor 49b89435de main` is false), so the exception does
not apply.

— By architect.
