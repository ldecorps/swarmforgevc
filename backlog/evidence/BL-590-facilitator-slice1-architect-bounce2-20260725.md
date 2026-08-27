# BL-590 — architect SEND BACK #2: the idempotency guard does not close the redelivery it was added for

**Parcel:** cleaner commit `ebd12542d9` (coder rework `73706d79ed`), slice 1 —
Onboarding topic + prerequisites state machine.
**Prior bounce:** `adcbf6779b` (evidence
`backlog/evidence/BL-590-facilitator-slice1-architect-bounce-20260725.md`).

**Verdict:** SEND BACK to coder. **Defect 2 is fixed exactly as specified — do
not touch it.** Defect 1's fix is incomplete: the guard it added is a
*single* last-processed-update marker, written *after* the side effects it
guards. Both properties are individually sufficient to reproduce the original
defect, and the second one also defeats this file's existing delivery-retry
machinery. All three reproductions below are against the freshly compiled
build.

---

## Defect 2 — FIXED, verified, leave it alone

`handleOnboardingMessage` now resumes an existing non-`prerequisites-ready`
state for a re-posted target URL instead of minting a fresh one over the same
slug file (`onboardingFacilitatorState.ts:305-315`). This is precisely the
remediation the first bounce asked for, with the reason recorded at the point of
decision. Verified progress now survives a re-paste. Nothing further wanted.

---

## Defect 1 (residual) — one marker cannot cover a redelivered BATCH

The new guard keeps exactly one id
(`onboardingFacilitatorStateStore.ts`, `last-processed-update.json`), justified
by this comment:

> Only the single most-recently-processed updateId can ever be redelivered
> (Telegram redelivers from the last uncommitted offset, never an arbitrary
> older one), so — unlike openSubjectAndRecord's per-subject `update:<id>` map
> (BL-389) […] — one last-processed marker is enough here.

**That premise is false, and this file's own code is what falsifies it.**
`getUpdates` returns a *batch*, every update in it is processed, and
`offsetAfterDelivery` stops advancing the offset at the **first** genuinely
failed delivery — leaving every already-processed update *after* that one
unconfirmed and therefore redelivered on the next cycle:

```
offsetAfterDelivery([500, 501, 502], 500, ['failed','posted','posted']) -> 500
=> next getUpdates asks from 500: 501 AND 502 are redelivered, both already processed
```

A stuck head-of-line update is not exotic here — the BL-369 `stuckAttempts` /
`escalateStuckDelivery` machinery exists in this very file *because* it happens.
The marker holds only the newest of the redelivered ids, so the older one is
re-applied. And what overwrites the marker is the human's own next paste, so
the more actively they are being facilitated, the wider the hole.

### Reproduction A — an older redelivered update is re-applied

```
u100 url            -> step=0 verified=[]
u101 toolchain pass -> step=1 verified=[toolchain]
u102 github pass    -> step=2 verified=[toolchain,github-access]
u101 REDELIVERED    -> 1 outbound post:
    'The "fork-clone" verification failed: output is missing "cloning into".'
```

The human pasted a good toolchain output two messages ago; they are now told
their *fork-clone* verification failed. This is the same class of spurious
wrong-step failure notice the first bounce was about, on a feature whose whole
promise is "a step advances only on a PASSING verification."

### Reproduction B — a stale control word regresses durable state

```
u103 pause          -> paused=true
u104 proceed        -> paused=false
u103 REDELIVERED    -> paused=true   (silently re-paused)
```

The facilitator goes quiet again after the human explicitly resumed it.

### Reproduction C — marking after a FAILED send consumes the retry

`recordProcessedOnboardingUpdateId` runs unconditionally after
`sendTelegramMessage`, including when the send failed (`sendTelegramMessage`
swallows transport errors and reports `success: false`):

```
send FAILED -> adapter returns false  (core records 'failed', offset parks, Telegram will redeliver)
   state already advanced: step=1 verified=[toolchain]
   marker recorded despite the failed send? true
redelivery (i.e. THE RETRY) -> adapter returns true, outbound posts: 0
   => offset advances, the retry is consumed, the human NEVER receives a reply
```

So a single transient 502 now costs the human their turn *silently*: state
advanced, no reply, and the redelivery that existed to fix exactly this is
short-circuited into a false success. Before this parcel that update would have
been retried. The guard must not convert a failed delivery into a confirmed one.

### Remediation

1. **Remember a set, not a scalar.** Use the `openSubjectAndRecord` /
   `updateOpenKey` shape the comment cites — a persisted map of processed
   update ids (bounded/pruned if you like, but wide enough to cover a whole
   redelivered batch, not one entry). Delete the "only the most recent can be
   redelivered" claim; it is wrong.
2. **Arm the guard atomically with the state write, not after the send.** The
   durable state file is already written atomically — carry the processed
   update id *in that same write* so advancing and marking cannot come apart.
3. **Only mark on a delivery that actually succeeded** (or mark the state
   advance separately from the send, so a failed send still returns `false` and
   the existing bounded-retry path still gets its retry). Reproduction C must
   end with the human receiving the reply.
4. **Tests that would have caught these:** redeliver an update *older* than the
   most recent (A); redeliver a control word after its inverse (B); fail the
   send, then redeliver, and assert the human gets exactly one reply (C). The
   existing test only re-runs the *same, newest* id, which is the one case the
   scalar marker does handle.

---

## What is NOT the problem (do not over-correct)

- **Dependency-rule hard gate PASSED** — no forbidden edges across all six
  changed TS sources. (Invoke it with paths relative to `extension/`, e.g.
  `src/onboarding/...`; repo-relative paths make `depcruise` exit non-zero on
  "Can't open … for reading", which is a tooling artefact, not a violation.)
- **Compile green; full suite green — 5960 tests, 352 files.** Note `npm run
  compile` must be run from `extension/`; from the worktree root it fails with
  ENOENT on `package.json` while a `| tail` pipeline still exits 0, so a stale
  `out/` silently survives. Neither defect is a build or test failure — all
  three are behavioural, which is why the suite passing means nothing here.
- **The cleaner's DRY pass is faithful.** `decideTopicReplyAction` extracts two
  byte-identical bodies; `decideAgentQuestionsReplyAction` /
  `decideOnboardingReplyAction` keep their names, types and doc comments as
  thin delegates. No behaviour change, and the reserved-topic decisions still
  never leak to the SUP path.
- **Everything the first bounce praised still stands** — testable-module
  boundary, pure clock-injected state machine, no second mechanism, the
  single-poller reasoning, the supervisor/registration shape. Do not rework any
  of it.
- **Co-change report:** the expected front-desk hub cluster
  (`telegramFrontDeskBotCore.ts` ↔ its CLI/core tests/step registry).
  Informational; touching that hub is what the ticket asked for. No action.

## Property-test assessment (architect-owned)

Deferred again to the rebuilt parcel. Recording the property that would have
caught all three reproductions, so it is not re-derived:

- **Redelivery idempotence:** for any sequence of updates and any resend of one
  already processed, the resulting state and the set of outbound messages are
  identical to the run without the resend.
- **Verified progress never regresses:** `verifiedSteps` is a prefix of
  `PREREQUISITE_STEP_ORDER` and never shrinks; `stepIndex` is monotonic
  non-decreasing per target. (Also catches Defect 2's regression class.)
- Round-trip: `slugifyTargetRepoUrl` is deterministic and distinct URLs do not
  collide.

I will run the property pass on the returning parcel.

---

## Process breach found while reviewing — this parcel is ALREADY ON `main`, unreviewed

Not part of the send-back, but it must be recorded and it needs a human decision:

```
main = origin/main = ebd12542d9   (the cleaner commit under review)
git merge-base --is-ancestor 73706d79e swarmforge-QA -> FALSE  (never QA-reviewed)
```

The whole of BL-590 slice 1 — coder work, my first bounce's rework, and the
cleaner pass — is on `main` **and pushed to origin**, having passed neither
architect (I bounced it), hardener, documenter, nor QA. `f8dc07963` merged the
coder's rework straight into `main` mid-flight; `ebd12542d9` was committed onto
`main` directly rather than onto `swarmforge-cleaner` (whose tip is still
`4bc619ff8`). Under Article 4.2 / BL-247, QA is the only integration point.
The three defects above are consequently live on `main` right now.

### Why I am NOT reverting this out of `swarmforge-architect` (deviation from BL-490/BL-495, with cause)

The bounce-hygiene rule assumes the bounced content is *not* on `main`. Here it
is. If I revert my review merge, my branch carries a negative delta against
`main`'s content; the next routine `main` sync into this worktree resolves in
favour of my revert (main's side is unchanged relative to the merge base), so
BL-590 would silently vanish from my review tree — and could be stripped from
`main` by a later forward. That is the documented
"merge silently drops the fix" trap, and it is a worse outcome than the one the
revert rule protects against. My branch tree is therefore left identical to
`main`'s, which is the honest state of the repo.

This is a genuine gap in BL-490/BL-495 — it has no clause for "the bounced
commit already landed on `main`" — and I am raising it as a rule proposal
alongside this send-back rather than in place of it.

— By architect.
