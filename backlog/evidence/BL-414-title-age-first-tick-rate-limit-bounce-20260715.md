# BL-414 hardener bounce — 20260715

## Verdict: BOUNCE to coder — title-age sync has no rate-limit protection on its first-tick mass fan-out

## What was reviewed

Merged architect's `970fd610ae` (BL-414-topic-title-age-suffix) into the
hardener worktree. Ran the full unit suite (4111 tests, green), CRAP (all
BL-414 functions <= 5.00), DRY (no clones touching the new files), and the
BL-113 soft Gherkin acceptance mutation pass (6/6 mutants killed) as the
combined hardening batch. Mutation cooldown gate (BL-149) reports
`skip-cooldown` for every changed file this pass (all touched within the
last 3 days), so no Stryker run was due this pass regardless.

While reviewing the wiring (`syncAllTitleAgeBuckets` /
`syncTitleAgeForBacklogId` in `extension/src/concierge/conciergeTick.ts`),
found that the architect's own `54e06b9b` rule_proposal — accepted into
`swarmforge/constitution/articles/engineering.prompt` while this parcel was
already in my inbox — describes exactly this ticket's own gap and states the
protection must exist "before handoff." It does not yet exist in the commit
I was handed, so I'm bouncing rather than silently forwarding past a
known, freshly-documented defect.

## The defect

`syncAllTitleAgeBuckets` (`conciergeTick.ts:262-281`) loops
`syncTitleAgeForBacklogId` over **every** ticket in `folders.active`,
`folders.paused`, and `folders.done` on **every tick**, gated only by
`decideTitleAge`'s bucket-equality check (`topicTitleAge.ts:86-89`). That
gate is a per-topic STEADY-STATE gate: it protects against re-editing a
topic whose bucket hasn't moved. It does nothing to bound the very first
tick this code ever runs (or any tick after a state loss/reset), because
on that tick `prevBuckets` is empty for every ticket at once — every
existing topic's bucket transitions from "unset" to its real value
simultaneously, and `syncTopicTitle` calls `adapters.setTopicTitle` (a bare
`editForumTopic({ name })`, `telegram-front-desk-bot.ts:741`) for all of
them back-to-back with no throttling, backoff, or 429 handling at all —
confirmed by grep: neither `topicTitleSync.ts` nor the title-age block of
`conciergeTick.ts` references `retry_after` or 429 anywhere, unlike
`backfill-topic-icons.ts` and `telegramClient.ts`, which do.

This is not hypothetical. It is the exact incident BL-342's own hand
backfill already hit once: `backfill-topic-icons.ts`'s own header records
"Too Many Requests: retry after 26" after **19 of 26** calls, with the
remaining calls dropped. This repo's current `backlog/topics/*.json` count
is **113** — every one of those is a topic this sync could try to retitle
on the same first tick, roughly 4x the volume that already tripped the
limit once. `readLastActivityMs` returning a real timestamp for any of
those 113 tickets (a near-certainty — the whole point of `blTopicStore` is
that ticket topics have message history) means the very first tick after
this code goes live very likely reproduces the same storm, on a larger
scale, with no retry_after wait between attempts.

## Why this is a bounce, not a hardener fix or a rule_proposal

The fix is new behavior — reusing `backfill-topic-icons.ts`'s existing
429/`retry_after`-honoring mechanism inside `syncAllTitleAgeBuckets`'s loop
(or bounding/staggering the first-pass volume some other way) — not a test
gap, a CRAP/DRY regression, or a mutation survivor. Same "correctness
defect is a send-back" discipline the architect's own prior bounces already
apply: the hardener does not own remediation design for a
robustness/architecture gap, only verifying test/quality metrics on top of
a design that's already sound. The rule the specifier just accepted
(`54e06b9b`) is the standing lesson for *future* tickets of this shape;
it does not retroactively fix *this* ticket's own gap, and the commit I
hold does not yet honor it.

## Remediation direction (not prescriptive — coder's call on mechanism)

`syncAllTitleAgeBuckets` (or `syncTopicTitle`/its `setTopicTitle` adapter)
needs to honor a 429's `retry_after` the way `backfill-topic-icons.ts` does
— wait the told-you-so duration before continuing to the next ticket,
rather than firing every `editForumTopic` call back-to-back unthrottled.
Whichever mechanism is chosen (reuse the backfill's helper directly, thread
a shared rate-limit-aware Telegram client call through both, or something
else), add a wiring test that seeds N (N > the historical trip threshold)
tickets with unset buckets and real activity in one tick and asserts the
sync either succeeds without dropping calls or genuinely waits out a
simulated 429 rather than losing tickets the way the original backfill did.

## Scope check

`970fd610ae` and its ancestors (`2c5d4ac461`, `d2d56a0b48`) do not have
`54e06b9b` as an ancestor (the rule was accepted after this parcel was
already forwarded to the hardener) — first time this specific gap is raised
as a bounce rather than just a standing rule.

By hardener.
