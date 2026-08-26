# BL-590 — architect PASS: bounce #8's declared-invariant property test verified non-vacuous; D1–D4 remain fixed

**Parcel:** cleaner commit `c02222544c` ("Merge coder BL-590 property test (81ad77f449)
into cleaner"), carrying coder commit `81ad77f449`. The only change since bounce
#7's `968eae4c88` is one new file, `extension/test/onboarderRedeliveryIdempotent.property.test.js`
(137 lines) — confirmed via `git diff --stat 968eae4c88..c02222544c` (the only
other file in range is bounce #8's own evidence note, already an ancestor).
D1–D4 and the BL-684 rename are untouched.

**Verdict: PASS — forwarding to hardener.**

## What was reviewed this round

Bounce #8 asked for exactly one thing: the ticket's declared invariant ("every
durable write is idempotent under redelivery of the same Telegram update") had
zero property-test coverage. The coder added
`onboarderRedeliveryIdempotent.property.test.js`, which:

- Drives the real `handleOnboarderMessage` wiring (never a mock of the guard
  under test), via compiled `out/onboarding/onboarderStateStore.js` and
  `out/tools/telegram-front-desk-bot.js`.
- Generates interleaved sequences of redelivered `updateId`s (pool 1–6, array
  length 1–14) and send-success/failure streams (boolean array length 1–6),
  keeping exactly one target in flight for the whole run by construction (the
  invariant's own guarded-path scope, per
  `telegram-front-desk-bot.ts:832-838`'s own comment).
- Asserts three things per redelivery: an already-delivered `updateId` sends
  nothing; a not-yet-delivered one retries with the EXACT first-computed body;
  and no redelivery ever mutates `onboardingStates(root)`.

## Independent verification performed this pass

- `npm run compile` — green.
- `npx vitest run --config vitest.properties.config.mjs test/onboarderRedeliveryIdempotent.property.test.js`
  — **1/1 pass**, 120 runs.
- **Non-vacuity re-proved independently** (not taken on the coder's commit-message
  claim alone): temporarily replaced `findProcessedOnboardingUpdate(targetPath, updateId)`
  at `telegram-front-desk-bot.ts:818` with a hardcoded `undefined`, recompiled,
  reran — property **failed immediately** with a minimal shrunk 2-op
  counterexample (`updateId 1` redelivered as `"done"` right after start),
  correctly diagnosing the reintroduced state-machine re-entry / recomputed-message
  defect. Reverted the mutation, recompiled, reran — green again.
  `git status --short` on the touched file confirmed clean after revert.
- `node out/tools/dependency-gate.js test/onboarderRedeliveryIdempotent.property.test.js`
  — PASSED, no forbidden edges.
- `node out/tools/co-change-report.js extension/test/onboarderRedeliveryIdempotent.property.test.js`
  — no co-changers (new file, no history yet); no coupling flagged.
- Regression check on the module area bounce #8 touched:
  `npx vitest run test/onboarderState.test.js test/onboarderStateStore.test.js`
  — 58/58, unchanged from bounce #8's own count.
- Forwarded-lineage: `git merge-base --is-ancestor c02222544c HEAD`, `968eae4c88`,
  and `609db8e724` all hold as ancestors after the merge.

## Wiring/config confirmed

- `vitest.properties.config.mjs`'s `include: ['test/**/*.property.test.js']`
  picks the new file up; `vitest.config.mjs` (unit/coverage/mutation) excludes
  the glob — the separation rule (engineering.prompt) holds structurally, not
  just by convention.
- `npm run test:properties` recompiles then runs this config — the file is
  reachable via the documented command.

## Invariants Review (BL-633/654) — closed

The ticket's one declared invariant now has non-vacuous, generator-driven
coverage, authored by the coder per BL-654 and independently re-proved
non-vacuous by the architect this pass. No other declared invariant exists on
this ticket. This closes the item bounces #7 and #8 both flagged.

## Forwarding

D1–D4 (bounce #7, reconfirmed bounce #8) plus the declared-invariant property
test (this pass) together clear every open item on this ticket's review chain.
Forwarding to hardener for mutation/CRAP hardening on `onboarderState.ts` /
`onboarderStateStore.ts` / `telegram-front-desk-bot.ts`'s onboarder surface.

---

*Architect pass on BL-590 bounce #8 rework (chain: ...bounce5, ...bounce6,
...bounce7, ...bounce8, this file).*
