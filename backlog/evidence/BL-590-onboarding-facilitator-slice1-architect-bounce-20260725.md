# BL-590 — architect SEND BACK: two un-guarded durable writes in the facilitator turn

**Parcel:** cleaner commit `8e76f8f10b` (coder `4851901ed`), slice 1 —
Onboarding topic + prerequisites state machine.

**Verdict:** SEND BACK to coder. The architecture is sound and I am **not**
asking for it to be reworked (see "What is NOT the problem" — read that first
so you do not over-correct). Two concrete defects, both in the same place: the
facilitator's per-message turn performs **durable side effects with no
idempotency guard**, and both are reachable on the happy path.

---

## Defect 1 — `updateId` is declared on the adapter contract, then dropped in the wiring

`PollAdapters` declares the third parameter, and the core passes it:

```ts
// telegramFrontDeskBotCore.ts:854
handleOnboardingFacilitatorMessage?: (topicId: number, text: string, updateId: number) => Promise<boolean>;
// telegramFrontDeskBotCore.ts:2102
const ok = await adapters.handleOnboardingFacilitatorMessage(topicId, decision.text, update.update_id);
```

The production wiring **discards it**, and the implementation has no parameter
for it and no dedupe:

```ts
// telegram-front-desk-bot.ts:2015
handleOnboardingFacilitatorMessage: (topicId, text) => handleOnboardingFacilitatorMessage(targetPath, botToken, chatId, topicId, text),

// telegram-front-desk-bot.ts:793 — no updateId, no guard, two side effects
async function handleOnboardingFacilitatorMessage(targetPath, botToken, chatId, topicId, text) {
  const states = listOnboardingFacilitatorStates(targetPath);
  const outcome = handleOnboardingMessage(states, text, Date.now);
  if (outcome.kind !== 'no-active-onboarding') {
    writeOnboardingFacilitatorState(targetPath, outcome.state);   // durable write
  }
  const result = await sendTelegramMessage(...);                  // outbound send
  return result.success;
}
```

This breaks an established contract in this very file. Every sibling
side-effecting side-channel adapter threads `updateId` into a durable guard —
`postToBridge` (BL-369) sends it as the bridge's idempotency key, and
`openSubjectAndRecord` guards on a persisted marker:

```ts
// telegram-front-desk-bot.ts:1330-1334
export async function openSubjectAndRecord(targetPath, topicId, text, updateId) {
  const already = readTopicMap(targetPath)[updateOpenKey(updateId)];
  if (already !== undefined) { return already; }        // redelivery = no-op
```

`telegramFrontDeskBotCore.ts:2182` states the loop's requirement outright:
deliveries are *"idempotent by update_id"*. **BL-389 was itself an architect
bounce that added `updateId` to `openSubjectAndRecord` for exactly this
reason.** The onboarding adapter is the only side-channel adapter in this file
that performs a durable *state-machine* write, and it is the only one without
the guard. Redelivery is a live hazard here, not theoretical — the offset only
advances after processing (`telegramFrontDeskBotCore.ts:2189`), so a crash
between the state write and the offset commit makes Telegram re-serve the same
update.

### Reproduced

Walking the real compiled state machine to `fork-clone`, feeding the passing
verification, then re-feeding the *same* paste (what a redelivery does):

```
at step: fork-clone
1st fork paste -> step now: target-repo | verified: toolchain,github-access,fork-clone
REDELIVERED same paste -> "The \"target-repo\" verification failed: output is missing \"origin\"."
```

The human pasted a good `fork-clone` output, watched it be accepted, and then
gets a **failure notice for `target-repo` — a step they have not been asked for
yet.** Plus a duplicate outbound post. For a feature whose entire promise is
"a step advances only on a PASSING verification, never on a claim", emitting a
spurious failure for the wrong step is a direct hit on the thing being built.

### Remediation

Thread `updateId` through and guard the durable write the way
`openSubjectAndRecord` already does — a persisted last-processed-update marker
(its own file under `.swarmforge/onboarding/`, or the same `updateOpenKey`
shape) checked before `writeOnboardingFacilitatorState`, so a redelivered
update is a no-op that re-sends nothing. Keep the guard in the **I/O shell**;
`handleOnboardingMessage` stays pure. Pin it with a unit test that calls the
turn twice with the same `updateId` and asserts one state write and one send.

---

## Defect 2 — re-posting the repo URL of an in-flight onboarding silently destroys verified progress

`handleOnboardingMessage` treats *any* whole-message repo URL as "start a new
onboarding", with no check for an existing in-flight state for that same URL
(`onboardingFacilitatorState.ts:305-308`). Because
`onboardingStatePath` keys the file by a slug of the URL
(`onboardingFacilitatorStateStore.ts:32-34`), the fresh state **overwrites the
same file**. Reproduced, continuing from the run above:

```
re-post URL kind: started | stepIndex: 0 | verified: []
same store slug? -> both write to the SAME file for git@github.com:org/repo.git
```

Three verified prerequisites are gone, with no warning. The human's plausible
reasons to re-paste the URL are ordinary: checking where things are, scrolling
back and re-sending, or resuming after a pause. Scenario 08's whole point is
that verified steps survive — surviving a *restart* but not a *duplicate
message* is a durability hole, and it is silent, which is the worst kind.

### Remediation

In `handleOnboardingMessage`, when a repo URL arrives and a non-`prerequisites-ready`
state already exists for that same target, **resume it** (return the existing
state and `renderStatus`) rather than minting a fresh one. If a genuine restart
is wanted, make it explicit (e.g. a `restart` control) — never the default for a
re-paste. Unit-test both: re-post of an in-flight URL preserves `verifiedSteps`;
a URL for a *different* target still opens its own state.

---

## What is NOT the problem (do not over-correct)

The design is good and most of it is better than it had to be. Keep all of it:

- **Dependency-rule hard gate PASSED** — no forbidden edges across all six
  changed TS sources (`onboardingFacilitatorState.ts`,
  `onboardingFacilitatorStateStore.ts`, `onboarding-facilitator-reconcile.ts`,
  `telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`).
- **Testable-module boundary is exactly right.** The state machine is pure and
  clock-injected; all content branching lives in `handleOnboardingMessage`; the
  shell is I/O only. This is the shape the ticket asked for.
- **No second mechanism anywhere.** `decideEnsureOnboardingTopicAction` is a
  faithful twin of its seven siblings; `ensureOnboardingTopic` mirrors
  `ensureAgentQuestionsTopic`; the supervisor reuses
  `front_desk_supervisor_lib.bb`'s pure state machine wholesale (bounded
  restart, backoff, heartbeat staleness) rather than reimplementing it.
- **The single-poller reasoning is the highlight of the parcel.** Recognising
  that a supervised second `getUpdates` loop on the primary token would
  409-conflict, and reducing the supervised process to outbound reconcile +
  heartbeat while inbound rides the existing poller, is the correct call and is
  documented at the point of decision.
- **Routing never leaks to SUP.** A message in the Onboarding topic is
  delivered or dropped, never opened as a fresh `SUP-###`.
- **Registration** in `start/stop_ancillary_services.sh` follows the front-desk
  pattern (skip env var, stop-file, pid signal, status/heartbeat cleanup).
- `npm run compile` green; **597 unit tests pass** across the five affected
  suites. Neither defect is a build or test failure — both are behavioural.
- Co-change report: the expected front-desk cluster
  (`telegramFrontDeskBotCore.ts` ↔ its CLI/tests/step-registry). Informational
  only; touching that hub is what the ticket asked for. No action.

## Property-test assessment (architect-owned)

Deferred to the rebuilt parcel, per the bounce. Worth recording that this is
**not** a parcel with no property-shaped module — `onboardingFacilitatorState.ts`
has real invariants, and one of them would have caught Defect 2:

- *verified progress never regresses* — across any sequence of messages,
  `verifiedSteps` is a prefix of `PREREQUISITE_STEP_ORDER` and never shrinks,
  and `stepIndex` is monotonic non-decreasing for a given target.
- round-trip: `slugifyTargetRepoUrl` is deterministic and distinct URLs do not
  collide.

I will run the property pass on the returning parcel.

## Note to myself for the rework (BL-490/BL-495 hygiene)

This bounced content is being reverted out of `swarmforge-architect` in the same
step as this send-back. When the rework returns, **revert the revert before
merging it**, or the base content will be silently missing from the review tree.

— By architect.
