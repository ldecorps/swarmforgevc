# BL-590 — architect SEND BACK #4: re-pasting the repo URL at `prerequisites-ready` silently destroys all five verified prerequisites

**Parcel:** cleaner-forwarded coder rework `fa443ec80e`, slice 1 — Onboarding
topic + prerequisites state machine.
**Reviewed at:** merge `8278d09140` on `swarmforge-architect`.

**Verdict:** SEND BACK to coder. **Bounce #3's defect is fixed correctly and
completely — do not touch it.** One defect remains, and it is *my* fault as
much as anyone's: it lives in the exact carve-out my own bounce #1 remediation
drew. Read "What is NOT the problem" before changing anything, and note that
the ask is **one line**.

---

## Bounce #3 is FIXED — verified, keep all of it

The no-active-onboarding branch is now guarded through the same single
`findProcessedOnboardingUpdate` call as every per-target branch, with a
shared, target-independent processed-updates store keyed the same way and the
same record-before-send / flip-on-success discipline. Reproductions D1 and D2
from bounce #3 are pinned as tests and both are non-vacuous. The
`undefined` → shared-store routing in `markOnboardingUpdateDelivered` is
consistent on both the first-attempt and the redelivery-retry path, and
`no-active-updates.json` is correctly excluded from `listOnboardingEnvelopes`
so it can never be mistaken for a target envelope.

I re-derived the invariant independently as a property (P3 below), broke the
fix deliberately, and watched the property re-find bounce #3's defect
unassisted. It is genuinely closed.

---

## Defect — the one branch the bounce-#1 fix exempted

`findInFlightStateForTarget` resumes an existing onboarding **only** when its
phase is not `prerequisites-ready`:

```ts
// onboardingFacilitatorState.ts:304-309
function findInFlightStateForTarget(existingStates, targetRepoUrl) {
  return existingStates.find((s) => s.targetRepoUrl === targetRepoUrl && s.phase !== 'prerequisites-ready');
}
```

So once the checklist is complete, a re-pasted repo URL falls through to
`createOnboardingState` — and because `onboardingStatePath` keys the durable
file by a slug of the URL alone, the fresh state **overwrites the same file**.
All five verified prerequisites are gone, silently, and the human is returned
to step 1.

This is bounce #1 defect 2 exactly, surviving in the single phase my own
remediation exempted — structurally the same shape as bounce #3 (a guard that
was correct for the branch it was aimed at, with one branch left uncovered).

### Reproduced end-to-end, through the real production shell, no source edits

Driving `handleOnboardingFacilitatorMessage` (the real wiring) against a real
temp `.swarmforge/onboarding/` store, walking all five steps with genuine
passing verification pastes, then re-pasting the same URL:

```
files on disk: github.com-acme-widget.json
BEFORE re-paste  phase=prerequisites-ready stepIndex=5
                 verified=[toolchain, github-access, fork-clone, target-repo, bot-token]
last message to human: "All prerequisites verified - prerequisites are ready.
                        Next comes the survey phase: I will survey your target repo…"
--- human re-pastes the SAME repo URL ---
AFTER  re-paste  phase=checking-prerequisites stepIndex=0 verified=[]
files on disk: github.com-acme-widget.json      <-- same file, overwritten
message to human: "Onboarding https://github.com/acme/widget: prerequisites phase,
                   step \"toolchain\"…"
```

### Why this is reachable, not theoretical

The terminal message itself invites it: *"Next comes the survey phase: I will
survey your **target repo**."* A human who reads that and helpfully re-posts
the repo URL — the single most natural thing to post in an onboarding topic —
loses five completed verifications and has to redo every one. The plausible
re-paste reasons I gave in bounce #1 (checking in, scrolling back, resuming
after a pause) all still apply, and the QA procedure's own step 5 walks a human
to exactly this state.

Bounce #1's remediation said it outright: *"If a genuine restart is wanted,
make it explicit (e.g. a `restart` control) — never the default for a
re-paste."* There is no `restart` control, and re-paste **is** the default at
this phase.

### Remediation — one line

Drop the phase filter; resume **any** existing state for that target URL:

```ts
function findInFlightStateForTarget(existingStates, targetRepoUrl) {
  return existingStates.find((s) => s.targetRepoUrl === targetRepoUrl);
}
```

`renderStatus` already returns the "all prerequisites verified / survey comes
next" message for a `prerequisites-ready` state, so a re-paste becomes a
harmless status re-statement — which is what the human wanted by re-pasting.
This also **removes** a special case rather than adding one.

Nothing else changes: `pickActiveOnboardingState` still excludes
`prerequisites-ready` states when routing a *plain* reply, so slice 2 (BL-624)
remains free to define what a URL means once the survey phase owns the target.
If an explicit re-onboard is ever wanted, it is a `restart` control on its own
ticket — never a silent side effect of the most natural message in the topic.

**Rename note:** with the filter gone, `findInFlightStateForTarget` is no
longer about "in flight" — call it `findStateForTarget`, and update the
comment above it (which currently justifies the exemption).

### Pin it with the property, not just an example

The example test to add is the obvious one (walk to `prerequisites-ready`,
re-paste the URL, assert `verifiedSteps` and `stepIndex` survive). But this
defect class has now escaped three example-test passes in a row, because an
example can only pin the branch someone thought of. **Add P4 below**; it fails
today with a minimal counterexample and goes green on the one-line fix.

---

## Architect property pass (architect-owned — role prompt "Property Testing")

`onboardingFacilitatorState.ts` is pure and clock-injected and
`onboardingFacilitatorStateStore.ts` is its durable twin — squarely inside the
testable-module boundary, and both were touched by this parcel. I wrote three
properties, confirmed each is **non-vacuous** by deliberately breaking its
invariant in the compiled output and watching it fail, then restored the build:

| Property | Break applied | Result |
|---|---|---|
| **P1** a bare completion claim never advances a step, from any point in the checklist (scenario 04, across the whole `BARE_DONE_PATTERN` language, not the four spellings the example test names) | made the bare-claim branch call `advanceStep` | **FAILED** as required |
| **P2** `slugifyTargetRepoUrl` is deterministic, non-empty, filesystem-safe and stable under re-slugging (it names the durable per-target file) | dropped the character substitution | **FAILED** as required |
| **P3** a redelivered `updateId` re-sends the message computed on the FIRST attempt and never re-enters the state machine, across any interleaving of updates and send failures | removed the shared no-active lookup (bounce #3's defect) | **FAILED** with `updateId 700 already landed - a redelivery must send nothing at all` |

All three pass on `fa443ec80e`. **P4 (below) fails on it** — that is this
bounce.

Because this parcel is going back, the property file is **not** committed to
`swarmforge-architect` (P3 would be red once the bounced merge is reverted out
per BL-490/BL-495). **Add it verbatim in the rework commit** as
`extension/test/onboardingFacilitator.property.test.js`; it runs only under
`npm run test:properties`.

### P4 — the property this bounce is about

Add this test to that same file. Note the **weighted** generator: an unweighted
uniform draw needs `(1/6)^5` to reach the terminal phase, and I watched an
unweighted version of this exact property pass 400 runs against the live defect
before I fixed the generator. A property that cannot reach the state is not a
property.

```js
// P4: verified prerequisite progress never regresses for a target. The
// checklist is a one-way ratchet - `verifiedSteps` is always the in-order
// prefix of PREREQUISITE_STEP_ORDER, and stepIndex never goes backwards, for
// ANY sequence of messages. Weighted so a walk deep into the checklist is
// COMMON: an unweighted uniform draw needs (1/6)^5 to reach
// prerequisites-ready and silently never exercises the terminal phase.
const ratchetOpArb = fc.oneof(
  { arbitrary: fc.constant('ADVANCE'), weight: 10 },
  { arbitrary: fc.constant('REPASTE_URL'), weight: 3 },
  { arbitrary: fc.constant('JUNK'), weight: 1 },
  { arbitrary: fc.constant('DONE'), weight: 1 },
  { arbitrary: fc.constant('PAUSE'), weight: 1 },
  { arbitrary: fc.constant('PROCEED'), weight: 1 }
);

// ADVANCE resolves at FOLD time to the passing paste for whatever step the
// state is actually on - that is what makes the deep state reachable.
function ratchetTextFor(op, state) {
  if (op === 'ADVANCE') { return PASSING_PASTES[state.stepIndex] ?? 'hi'; }
  if (op === 'REPASTE_URL') { return TARGET_URL; }
  if (op === 'JUNK') { return 'fatal: repository not found'; }
  return op.toLowerCase();
}

test('P4: verified prerequisite progress never regresses for a target', () => {
  fc.assert(
    fc.property(fc.array(ratchetOpArb, { minLength: 1, maxLength: 12 }), (ops) => {
      let current = 0;
      const now = monotonicClock();
      let state = createOnboardingState(TARGET_URL, now);
      const trail = [];
      for (const op of ops) {
        trail.push(op);
        const outcome = handleOnboardingMessage([state], ratchetTextFor(op, state), now);
        if (outcome.kind === 'no-active-onboarding') { continue; }
        state = outcome.state;
        assert.deepEqual(
          state.verifiedSteps,
          PREREQUISITE_STEP_ORDER.slice(0, state.stepIndex),
          'verifiedSteps must always be the in-order prefix of the checklist'
        );
        assert.ok(
          state.stepIndex >= current,
          `verified progress regressed ${current} -> ${state.stepIndex} on op ${op}; trail=[${trail}]`
        );
        current = state.stepIndex;
      }
    }),
    { numRuns: 400 }
  );
});
```

Counterexample it finds today, unshrunk and already minimal:

```
AssertionError: verified progress regressed 5 -> 0 on op REPASTE_URL;
                trail=[ADVANCE,ADVANCE,ADVANCE,ADVANCE,ADVANCE,REPASTE_URL]
```

### P1–P3, to add verbatim

The full file is committed alongside this evidence, parked outside the test
tree so it is not collected while the parcel is out for rework. Copy it into
place in the rework commit and add P4 to it:

```sh
cp backlog/evidence/BL-590-onboardingFacilitator.property.test.js \
   extension/test/onboardingFacilitator.property.test.js
# add P4 above, then:
cd extension && npm run test:properties
```

Its `require` paths (`../out/…`, `./helpers/tmpDir`) are already written for
`extension/test/`, so the copy needs no edits. It carries `monotonicClock`,
`TARGET_URL` and `PASSING_PASTES`, which P4 above reuses.

---

## What is NOT the problem (do not over-correct)

Everything below is verified good on `fa443ec80e`. Change none of it:

- **Dependency-rule hard gate PASSED** — `node extension/out/tools/dependency-gate.js
  src/onboarding/onboardingFacilitatorStateStore.ts src/tools/telegram-front-desk-bot.ts`
  → "no forbidden edges". No boundary violation anywhere in this parcel.
- **The bounce-#3 fix is right.** One guard, both branches, one lookup. The
  shared store is the correct home for a branch that has no target to key by,
  and keeping the per-target marker inside the envelope preserves bounce #2's
  atomic state+marker write. Do not merge the two stores.
- **Bounce #1 and #2 defects are all fixed and stay fixed**: `updateId` threaded
  through the adapter, per-target SET guard, atomic state+marker write,
  deliver-only-on-success flag, resume-instead-of-restart for an in-flight
  target.
- **Testable-module boundary is exactly right** — pure clock-injected state
  machine, all content branching in `handleOnboardingMessage`, I/O-only shell.
- **Compile green; 5967 unit tests pass** (352 files). The three new
  bounce-#3 reproduction tests are non-vacuous.
- **Co-change report**: only the expected front-desk cluster
  (`telegramFrontDeskBotCore.ts` ↔ its CLI/tests/step-registry) plus the
  store ↔ bot ↔ CLI-test triple this parcel introduced together.
  Informational only. No action.
- **Parcel scope is clean** (BL-506): the diff against `main` is the two source
  files, their test file, and architect evidence. No ticket-less functional
  files.

## Noted, NOT asked for (do not action in this parcel)

- `no-active-updates.json` and each envelope's `processedUpdates` grow without
  bound and are rewritten whole on every inbound message. At onboarding-topic
  volume this is harmless, and pruning has its own correctness questions (how
  long must a guard remember?). Flagging only — **do not add pruning here**;
  if it is ever wanted it is its own ticket.
- `slugifyTargetRepoUrl`'s comment claims "two distinct URLs never collide".
  Not literally true (it canonicalises scheme and `.git`, which is the useful
  behaviour), and the SSH and HTTPS forms of the *same* repo produce *different*
  slugs. Both are benign for slice 1. **Comment accuracy only** — a documenter
  note, not a code change.

---

## Bounce hygiene (BL-490/BL-495)

`fa443ec80e` is **not** on `main`, so unlike bounce #3 this content is being
reverted out of `swarmforge-architect` in the same step as this send-back:
`git revert -m 1 8278d09140`, with `git merge-base --is-ancestor fa443ec80e HEAD`
confirmed FALSE afterwards.

**When the rework returns: revert the revert BEFORE merging it**, or the
bounce-#3 fix will be silently missing from the review tree — and re-run the
unit suite after the merge (a merge can drop a fix from a hunk only one side
touched).

— By architect.
