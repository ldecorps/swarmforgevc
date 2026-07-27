# BL-590 — architect SEND BACK #7: bounces #5 and #6 are fixed on paper only — none of their fixes are in the code the pipeline is now reviewing

**Parcel:** cleaner-forwarded review commit `609db8e724`, merged for architect
review at `4d3cab096` on `swarmforge-architect` (merge of `609db8e724` after
merging QA-approved `6a8d3d2ee` for BL-684).
**Ticket instruction being followed:** `backlog/active/BL-590-...yaml`'s
`unparked:` block says "the architect reviews `01562217be` against SEND BACK
#6's D3/D4." `01562217be` is **not an ancestor** of the parcel under review —
it was never merged. Checked directly (`git merge-base --is-ancestor
01562217be 609db8e724` → false), not assumed.

**Verdict: SEND BACK.** This is not a new defect I went looking for — it is
four already-diagnosed, already-fixed, already-verified defects
(`backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-20260725.md`
D1/D2, `backlog/evidence/BL-590-facilitator-slice1-architect-bounce6-20260725.md`
D3/D4) that are **absent from the code currently on `main`** — the code this
parcel is meant to finish reviewing. The tangled revert/reapply chain visible
in `git log --oneline -- extension/src/onboarding/onboarderStateStore.ts`
(`14413c755` bounce #5 fix → `ad4761ebb` revert → `d73080a74` reapply →
`55ada48bc` revert of the reapply, net: absent) shows why, but the *why* is not
this bounce's job to fix — reapplying the already-specified fixes is.

Read "What is NOT the problem" before changing anything.

---

## D1 (HIGH, regressed) — slug collision is back

`slugifyTargetRepoUrl` (`extension/src/onboarding/onboarderStateStore.ts:26-30`)
has no digest suffix. Reproduced against the current compiled module, same
counterexample bounce #5 used:

```
$ node -e "const {slugifyTargetRepoUrl}=require('./out/onboarding/onboarderStateStore.js');
console.log(slugifyTargetRepoUrl('https://github.com/acme/tools-ci'));
console.log(slugifyTargetRepoUrl('https://github.com/acme-tools/ci'));"
github.com-acme-tools-ci
github.com-acme-tools-ci
```

Two different orgs, two different repos, one state file — exactly bounce #5's
D1. The remediation (injective slug: readable prefix + 8-char sha1 of the
normalized URL, full code in bounce5's evidence file) was verified correct
there and is not being re-litigated here; it just needs to actually land.

## D2 (MEDIUM, regressed) — any non-state `.json` sibling becomes a fake state via an unvalidated cast

`listOnboardingEnvelopes` (`onboarderStateStore.ts:111-121`) still does
`return isEnvelope(parsed) ? parsed : { state: parsed as OnboarderState,
processedUpdates: {} };` on the false branch — the deny-by-filename /
unchecked-cast shape bounce #5 flagged. `readEnvelope`'s own `as` cast
(line 75) is *more* exposed now than bounce #6 judged it, because bounce #6's
"not worth changing" call rested on D1's digest suffix making a collision at
that exact path effectively impossible — and D1 is not fixed here either.
Remediation: the shape-validating `isFacilitatorState`/`isOnboarderState`
allow-list from bounce5's evidence file, replacing the deny-by-filename check.

## D3 (HIGH, regressed) — the handler and the store still disagree on target identity

`findInFlightStateForTarget` (`extension/src/onboarding/onboarderState.ts:304-309`)
still compares `s.targetRepoUrl === targetRepoUrl` — raw string equality —
while the store's `slugifyTargetRepoUrl` normalizes (strips scheme, strips
`.git`) and deliberately collapses aliases onto one file. Bounce #6's own
repro (paste a URL to prerequisites-ready, paste the same repo as `.git` or
`http://` instead of `https://`, watch the second paste's mint-fresh-state
write land on and destroy the first paste's file) was verified against
`c336270e05` and is unchanged today — nothing in the diff between `c336270e05`
and this parcel touches either comparison site. Remediation: the single
`normalizeTargetRepoUrl` / `isSameTarget` pair specified in bounce6, imported
by both the handler's comparison and the store's `slugifyTargetRepoUrl`, so
the two layers cannot drift apart again (full code + property P6 in bounce6's
evidence file).

## D4 (LOW, regressed) — `.git` stripped before the trailing slash

Same normalizer, same file, per bounce6: `repo.git/` does not normalize to the
same key as `repo.git` because the trailing-slash strip runs after the `.git`
strip today. Fix lands as part of D3's shared normalizer.

## Missing property coverage (Invariants Review, BL-633/654)

The ticket declares one invariant: *"Every durable write is idempotent under
redelivery of the same Telegram update."* Per this role's Invariants Review
process, existence of a property test encoding a declared invariant is checked
**before** any hand-verification of the property itself. There is none:
`find extension/test -iname "*onboardingFacilitator*" -o -iname
"*onboarder*property*"` returns only `onboarderLauncherPidGuard`,
`onboarderRenamedPathsResolve`, and `onboarderEvidenceByteIdentical` — none of
them exercise redelivery idempotency, and none of P1–P6 (bounces #4/#5/#6's
own properties) exist anywhere under `extension/test/`. They exist only as
`backlog/evidence/BL-590-onboardingFacilitator.property.test.js` and the two
`.parked` files (`bounce5-P5`, `bounce6-P6`) — never adopted into the live
suite. This is a distinct, independent gap from D1–D4 above (a missing test,
not a wrong behavior) but blocks the same invariant family, so it rides the
same bounce rather than a second round-trip.

Note for whoever records this: `KNOWN_FAILURE_CLASSES` in
`extension/src/quality/qaBounce.ts` is closed to `compile|unit|integration|
acceptance|behavior` — it does not yet contain an `invariant-unencoded` value
despite this role's own prompt naming that failure class (BL-654). Recorded
below under `behavior`, the closest existing class, since `record-bounce.js`
would reject anything else; the class-vocabulary gap itself is a small
follow-up, not a blocker.

---

## What is NOT the problem — do not change these

- **Bounce #4's fix** (`findInFlightStateForTarget` resumes at every non-ready
  phase, not just an exact narrow case) — present and correct at
  `onboarderState.ts:304-309`. Only its *comparison operator* needs to change
  (D3), not its resume-always semantics.
- **The cleaner's own `609db8e724` diff** (rename-allowlist path fix +
  `attemptOnboardingTopicDelivery` refuse-branch test) — reviewed, correct,
  no functional issue. It is not what this bounce is about; it is simply too
  small a diff to have been expected to reapply four unrelated prior fixes.
- **`isEnvelope`, `writeEnvelope`, `atomicWrite` usage, the processed-update
  redelivery-guard SET shape (bounce #2's fix)** — all present and correct as
  reviewed in earlier bounces.
- **BL-684's rename** — mechanical, unrelated to any of the above; not
  reviewed again here beyond confirming it did not touch either comparison
  site (it didn't — `grep -rn slugifyTargetRepoUrl` after the rename returns
  the same two call sites bounce #6 already enumerated).

## Gates run this pass

- `npm run compile` — green.
- `node out/tools/dependency-gate.js` over the touched onboarding + wiring
  files — **PASSED, no forbidden edges.**
- `node out/tools/co-change-report.js` over `onboarderState.ts` +
  `onboarderStateStore.ts` — no pair at or above the default threshold; no
  suspected coupling flagged.
- `npx vitest run test/onboarderState.test.js test/onboarderStateStore.test.js`
  — 52/52 pass (expected: neither D1 nor D3 has a test today, which is exactly
  the gap this bounce is about).
- Forwarded-lineage check — `609db8e724` is an ancestor of the review merge;
  `6a8d3d2ee` (QA-approved BL-684) also merged first and is an ancestor.

---

*Architect bounce #7 on BL-590 (bounce chain: ...bounce5, ...bounce6, this
file). Recorded via `record-bounce.js --by architect` (BL-635) rather than
left as prose-only, unlike bounce #6 which predates that tool.*
