# BL-590 — architect SEND BACK #8: D1–D4 are correctly reapplied; the one thing still missing is the declared invariant's property test, and it is not this bounce's job to write it

**Parcel:** cleaner commit `968eae4c88` ("BL-590: reapply bounces #5/#6's lost
fixes (architect send-back #7)"), merged for architect review at `607aed9f6`
on `swarmforge-architect`. Ancestry checked:
`git merge-base --is-ancestor 968eae4c88 HEAD` holds after the merge; `609db8e724`
and `6a8d3d2ee` (QA-approved BL-684) are both still ancestors.

**Verdict: SEND BACK — narrow.** Bounce #7's D1–D4 are now genuinely fixed, not
paper-fixed. This is not a re-litigation of anything closed below; it is the one
item bounce #7 flagged as independent and distinct, still unresolved.

## Confirmed FIXED — do not re-touch

- **D1** (`onboarderStateStore.ts:32-37`): `slugifyTargetRepoUrl` appends an
  8-char sha1 digest of the normalized URL. Reproduced bounce #5's exact
  counterexample against the current compiled module —
  `slugifyTargetRepoUrl('https://github.com/acme/tools-ci')` and
  `slugifyTargetRepoUrl('https://github.com/acme-tools/ci')` now differ.
- **D2** (`onboarderStateStore.ts:80-87`): `isOnboarderState` shape allow-list
  replaces the deny-by-filename cast in both `readEnvelope` and
  `listOnboardingEnvelopes`. A foreign shapeless `.json` sibling is dropped,
  not cast into a fake state (test added: "a shapeless sibling .json ... must
  be dropped").
- **D3/D4** (`onboarderState.ts:24-35`): one shared `normalizeTargetRepoUrl` /
  `isSameTarget` pair, imported by both `findInFlightStateForTarget`
  (`onboarderState.ts:326-330`) and the store's `slugifyTargetRepoUrl`. Strip
  order (trailing slash, `.git`, trailing slash again) makes `repo.git/`
  normalize like `repo.git`.
- **Consumer sweep** (BL-629's own lesson: a missed consumer is how this class
  of defect survives a fix): `grep -rn "targetRepoUrl ===" src/` now returns
  only the `typeof ... === 'string'` shape check in `isOnboarderState` — no
  remaining raw-string comparison site anywhere in `src/`.
- Both new test files exercise the alias-collapse and injectivity properties
  with concrete examples (not yet the property-test form — see below).

## Still open — D5 (Invariants Review, BL-633/654): the ticket's declared invariant has zero property-test coverage in the live suite

The ticket declares one invariant: *"Every durable write is idempotent under
redelivery of the same Telegram update."* Per this role's Invariants Review
process, existence of a non-vacuous property test encoding a declared invariant
is checked **before** any hand-verification of the property — same rule bounce
#7 cited, still true today:

```
$ find extension/test -iname "*onboarder*propert*"
extension/test/onboarderLauncherPidGuard.property.test.js
extension/test/onboarderRenamedPathsResolve.property.test.js
extension/test/onboarderEvidenceByteIdentical.property.test.js
$ grep -l "idempot\|redeliver\|processedUpdate\|delivered" extension/test/*.property.test.js
(no output)
```

None of the three live property files touch redelivery/idempotency at all. The
only property test that ever encoded this (`P3` in
`backlog/evidence/BL-590-onboardingFacilitator.property.test.js`) exists solely
as an evidence artifact — never adopted into `extension/test/` — and it is now
additionally **stale**: it imports `onboardingFacilitatorState` /
`onboardingFacilitatorStateStore` / `telegram-front-desk-bot`'s old
pre-BL-684-rename names, not today's `onboarderState` / `onboarderStateStore`.
Copying it in verbatim would not even compile.

**This is not cleaner's defect and not this bounce's fix to write.**
`coder.prompt`'s Invariants section (BL-654) is unconditional: *"first
authorship of each declared invariant's property test rests with the coder —
in every path this ticket writes, including bounce rework, no path leaves the
architect authoring it."* Cleaner's own forward note said as much ("out of
cleaner's remit (property tests); flagged in the forward for whoever picks it
up next") — correctly declining rather than reaching past its role boundary.
Architect is equally barred from writing it. That leaves exactly one owner:
the coder.

**Why this bounce goes to `coder` despite the ticket's `required_stages:
[cleaner, architect, hardener, documenter, qa]` excluding it:** that allowlist
only rewrites *forward* dispatch (`required_stages_lib.bb` /
`route-required-stages` in `swarm_handoff.bb`) — a handoff whose recipient is
canonically *after* the sender. A reviewer bounce to an earlier stage is the
opposite direction and falls through untouched by design
(`swarm_handoff.bb:394-412`: *"A bounce always targets an earlier stage
relative to its sender, so it falls through to the literal recipients
untouched"*). Coder is canonically before architect, so this bounce reaches
coder exactly as addressed; it is not a rebuild of shipped work (the D1–D4
behavior fixes above are NOT being reopened), only the missing property test.

### Remediation (coder, scoped narrowly — do not touch D1–D4 or the rename)

Add one `extension/test/*.property.test.js` file (fast-check, per
engineering.prompt/coder.prompt's separation rule — runnable only via
`npm run test:properties`) encoding: *for any sequence of
`writeOnboardingStateAndMarkUpdateProcessed` / `markOnboardingUpdateDelivered`
calls interleaved with redelivered `updateId`s (including send-failure retries
before a `markOnboardingUpdateDelivered`), a redelivered `updateId` always
re-surfaces the message computed on its FIRST processing
(`findProcessedOnboardingUpdate`) and the state machine is never re-entered for
it.* This is `P3` from the stale evidence file, adapted to current names
(`onboarderState.ts` / `onboarderStateStore.ts`) — the invariant itself was
already verified sound in bounce #4/#5/#6's own repros; only the executable,
non-vacuous encoding is missing. Per coder.prompt's generator-reach
requirement, weight the generator so send-failure-then-redelivery sequences are
common, not astronomically rare. Show the property fails against a
deliberately broken `markOnboardingUpdateDelivered`/`findProcessedOnboardingUpdate`
before restoring it (non-vacuity proof), then hand off to cleaner as normal.

Recorded under failure class `behavior` (bounce #7's own note stands: no
`invariant-unencoded` value exists in `KNOWN_FAILURE_CLASSES` yet — a small
follow-up, not a blocker here).

## Gates run this pass

- `npm run compile` — green.
- `node out/tools/dependency-gate.js src/onboarding/onboarderState.ts src/onboarding/onboarderStateStore.ts` — **PASSED, no forbidden edges.**
- `node out/tools/co-change-report.js src/onboarding/onboarderState.ts src/onboarding/onboarderStateStore.ts` — only the mutual state/store/test coupling (2 co-changes, below the default frequency-3 threshold); no suspected coupling flagged.
- `npx vitest run test/onboarderState.test.js test/onboarderStateStore.test.js` — **58/58 pass** (38 + 20, up from bounce #7's 52).
- Consumer sweep: `grep -rn "targetRepoUrl ===" src/` — no remaining raw comparison site.
- Forwarded-lineage check: `609db8e724` and `6a8d3d2ee` both ancestors of the review merge.

---

*Architect bounce #8 on BL-590 (chain: ...bounce5, ...bounce6, ...bounce7, this
file). Recorded via `record-bounce.js --by architect`.*
