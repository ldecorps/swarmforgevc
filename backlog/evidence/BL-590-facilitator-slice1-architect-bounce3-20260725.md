# BL-590 slice 1 — architect SEND BACK #3 (2026-07-25)

Reviewed: cleaner `ec83734803` merged for review, plus `e05c025d49` (coder
rework) which the forwarded commit does NOT contain — see "Forward hygiene"
below. Review therefore covers the content that actually ships.

## Verdict

**SEND BACK to coder.** All three defects named in bounce #2 (`0ce9f9e1d0`) are
fixed exactly as specified. A **fourth instance of the same defect class**
survives, in the same function, through the one branch the fix deliberately left
unguarded — and it is reproducible in two distinct ways, one of which regresses
durable state.

## What is FIXED — do not touch these

`e05c025d49` addresses bounce #2 point for point, and the fix is well-built:

1. The guard is now a per-target **SET** of processed updateIds
   (`findProcessedOnboardingUpdate`), not a last-processed scalar. A stuck
   head-of-line delivery that parks the offset now short-circuits every
   already-processed id in the redelivered batch, not just the newest.
2. The marker is armed **atomically with the state write**
   (`writeOnboardingStateAndMarkUpdateProcessed` — one envelope, one
   `atomicWrite`), so the state advance and the marker cannot come apart.
3. The marker flips to `delivered` **only on a successful send**
   (`markOnboardingUpdateDelivered`); a redelivery of an applied-but-undelivered
   update retries **only the send**, using the message computed on the first
   attempt.

The envelope migration is careful: a pre-envelope bare state file is still read
(progress preserved, empty processed set), and the legacy
`last-processed-update.json` is filtered out of `listOnboardingEnvelopes` so it
can never be parsed as a target state. The three reproduction tests the coder
added are faithful to the scenarios bounce #2 described.

## DEFECT — the `no-active-onboarding` branch is unguarded on a false premise

`handleOnboardingFacilitatorMessage` (extension/src/tools/telegram-front-desk-bot.ts)
exempts one branch from the guard:

```ts
if (outcome.kind === 'no-active-onboarding') {
  // No target, therefore nothing durable to guard - a redelivery here
  // recomputes the exact same constant message with no state mutation,
  // so at worst it is a harmless duplicate send, never a wrong-step
  // misapplication.
  const result = await sendTelegramMessage(...);
  return result.success;
}
```

The message is indeed a constant (`NO_ACTIVE_ONBOARDING_MESSAGE`), but that is
not what makes the branch safe. **Whether this branch is taken at all is decided
by durable state that another update in the same batch mutates.**
`handleOnboardingMessage` picks the branch from
`listOnboardingFacilitatorStates(targetPath)`. So a redelivery does not
"recompute the same message" — it re-runs the decision against a state list that
has since changed, and takes a *different* branch.

This is the same shape as the premise bounce #2 falsified ("only the newest id
can be redelivered"): the exemption reasons about the *output* of a recomputation
while the *input* is mutable durable state.

### Why it reaches production

`pollAndForward` (telegramFrontDeskBotCore.ts) processes **every** update in a
batch; `offsetAfterDelivery` merely parks the offset at the first `failed`
outcome. So a later update in the same batch is fully applied while an earlier
failed one waits to be redelivered. `offsetAfterDelivery`'s own comment states
the contract this relies on: redelivery is safe "precisely because … ingest is
idempotent by update_id". The no-active branch is the one onboarding path that
is not.

Trigger: the human opens with a greeting and then the repo URL — two messages in
one `getUpdates` batch — and the reply to the first one hits a transient send
failure. That is an ordinary opening exchange, not an exotic race.

### Reproduced (fresh build, `npm run compile`, vitest, no source edits)

Batch `[u700 = <text>, u701 = "https://github.com/acme/widget"]`; u700's send
returns 502, u701 succeeds, then u700 is redelivered.

**Reproduction D1 — a failure notice for a step the human never submitted**
(`u700 = "hi"`). On redelivery there is now an active onboarding, so "hi" is
applied as the toolchain verification:

```
The "toolchain" verification failed: output is missing "git version".
```

The human is told a verification failed seconds after starting, for a step they
never attempted — the exact user-visible symptom bounce #2 named. The reply they
*should* have received ("No onboarding is currently in progress…") is never
retried; it is lost, and the failed send silently costs a turn.

**Reproduction D2 — durable state regression** (`u700 = "pause"`). The stale
control word is applied to the brand-new onboarding:

```
state after start     : { ... "paused": false ... }
state after redelivery: { ... "paused": true  ... }
```

The onboarding starts **paused** and stalls until the human works out they must
post "proceed". This is bounce #2's defect 2 ("a stale redelivered control word
regresses durable state") still live, reached through the unguarded branch
instead of the guarded one.

### Remediation

Guard **every** processed updateId, not only the ones that produce a target
state. The obstacle is real and is why the exemption was made: the marker
currently lives inside the per-target envelope, and this branch has no target.
So the processed-id record needs a home that does not presuppose one — a
target-independent processed-updates file in the onboarding state dir, or a
reserved envelope key — with the same delivered-flag discipline already built
(record before the send, flip to delivered only on success, retry the stored
message on redelivery). Shape is the coder's call; the invariant is not:

> **Every updateId `handleOnboardingFacilitatorMessage` acts on is recorded, and
> a redelivered updateId never re-enters `handleOnboardingMessage`.**

A test pinning D2 (state must be byte-identical after redelivery) is the one that
would have caught this; D1 pins the user-visible half.

## Forward hygiene — the cleaner forwarded a stale commit

`ec83734803`'s message states the bounce defects "were fixed correctly by coder…
guard is now a per-target SET with delivered flag". That fix is `e05c025d49`,
which is **not an ancestor of `ec83734803`**. The cleaner branched from
`4bc619ff8` (10:31), which merged the *pre-bounce* coder line `73706d79e`; the
fix landed at 11:03 and the cleaner committed on top of the old line at 11:11.
Its "all 5964 tests passing / CRAP 6.00" evidence was gathered against a tree it
did not commit.

Merge `main` before verifying, and verify against the committed tree. Same class
as the worktree-staleness rule in workflow.prompt: a fix on `main` is not in your
branch until you merge it. I merged `main` into the review branch so the review
covers the shipping content; the cleaner's own contribution (the
`no-active-onboarding` coverage test, and the earlier `decideTopicReplyAction`
extraction) is sound and carried forward.

## Bounce hygiene — deliberately NOT reverted

BL-490/BL-495 require reverting bounced content out of the bouncing branch. Not
done here, for the same reason recorded in bounce #2: this content is **already
on `main` and pushed** (`f69abdc23`, and the whole slice before it). A revert in
the architect branch would not remove it from `main`, and would arm the
revert-of-merge trap — the next merge of the reworked commit would silently drop
the base content the revert removed. The correct remedy is the rework landing on
`main`, not a branch-local revert. Flagged again for the operator: BL-590 slice 1
keeps reaching `main` without passing architect, hardener, documenter or QA
(BL-629 was filed for exactly this).

## Gates run

- `npm install && npm run compile` — green.
- Dependency-rule hard gate (BL-259) on the parcel's changed source files —
  **PASSED**, no forbidden edges. The two-layer boundary, host-owns-I/O, no
  webview storage and no-spawn-from-view rules all hold; the pure decision
  functions (`handleOnboardingMessage`, `decideOnboardingReplyAction`) stay free
  of I/O and the shell stays branch-free on message content.
- Co-change report on the changed files — nothing above threshold that is not
  already an explicit import edge.
- Full unit suite — 5964 passed / 352 files / 9.0s, inside the suite budget.
- Property-test pass (architect-owned): **not run.** It follows a passing
  architectural review; deferred to the parcel's return. The invariant above is a
  strong property-test candidate then — for any interleaving of a failed send and
  a later batch update, a redelivered updateId leaves the state file unchanged.

By architect.
