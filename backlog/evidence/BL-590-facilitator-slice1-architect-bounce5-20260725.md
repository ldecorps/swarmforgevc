# BL-590 — architect SEND BACK #5: two distinct target repos share one durable state file

**Parcel:** cleaner-forwarded coder rework `3fe9a0c203`, slice 1 — Onboarding
topic + prerequisites state machine.
**Reviewed at:** merge `64905c0f4c` on `swarmforge-architect`.

**Verdict:** SEND BACK to coder. **Bounce #4's fix is correct and complete — do
not touch it.** Two defects remain, both reproduced end-to-end against the real
compiled modules with no source edits. D1 is the same failure mode as bounce #4
through a different door, and it is high severity. D2 is currently latent but
becomes live the moment slice 2 or 3 writes anything into the onboarding state
directory — which the design says it will.

Read "What is NOT the problem" before changing anything.

---

## Bounce #4 is FIXED — verified, keep all of it

`findInFlightStateForTarget` → `findStateForTarget` is exactly right: any
existing state for the URL now resumes, at every phase, and the special case is
gone rather than replaced by a narrower one. `renderStatus` renders the
prerequisites-ready message so a re-paste is a harmless status re-statement, and
the amended unit test pins all five `verifiedSteps` surviving. P1–P4 landed
faithfully, P4 reproduces bounce #4 with the weighted generator intact.

Verification of the parcel as received:

- `npm run compile` — green.
- `npm test` — **5967 unit tests, 352 files, all pass.**
- `npm run test:properties` — **48 property tests, all pass**, including the new
  P1–P4.
- Dependency-rule hard gate (`dependency-gate.js`) on all three changed source
  files — **PASSED, no forbidden edges.**
- Parcel scope (BL-506) — clean; every changed file belongs to BL-590.
- Forwarded-lineage check — `3fe9a0c203` is an ancestor of the review merge.

---

## D1 (HIGH) — `slugifyTargetRepoUrl` is not injective; onboarding one target destroys another's verified prerequisites

### The false claim

`extension/src/onboarding/onboardingFacilitatorStateStore.ts:22-29` states the
invariant the whole per-target design rests on:

> A filesystem-safe, human-recognizable key for a target repo URL — strips the
> scheme and replaces anything that isn't alphanumeric/-/. with '-', **so two
> distinct URLs never collide** […]

That claim is false, and the collision needs nothing exotic. Because *both* the
path separator `/` and any run of other punctuation collapse to the **same**
character `-`, the org/repo boundary stops being recoverable:

| target repo | slug → state file |
|---|---|
| `https://github.com/acme/tools-ci` (org `acme`, repo `tools-ci`) | `github.com-acme-tools-ci.json` |
| `https://github.com/acme-tools/ci` (org `acme-tools`, repo `ci`) | `github.com-acme-tools-ci.json` |

Two different organisations, two different repositories, **one state file.**
Both are entirely ordinary GitHub URLs.

### Reproduction — through the real production shell

`handleOnboardingFacilitatorMessage` against a real `.swarmforge/onboarding/`
store, real compiled `out/`, no source edits, no stubs beyond a
success-returning `postFn`:

```
== 1. Target T1 (acme/tools-ci) walked to prerequisites-ready ==
  files on disk: ["github.com-acme-tools-ci.json"]
  https://github.com/acme/tools-ci  phase=prerequisites-ready stepIndex=5
    verified=[toolchain,github-access,fork-clone,target-repo,bot-token]

== 2. Human pastes T2 (acme-tools/ci), a DIFFERENT real repo ==
  files on disk: ["github.com-acme-tools-ci.json"]
  https://github.com/acme-tools/ci  phase=checking-prerequisites stepIndex=0
    verified=[]                         <-- T1's five prerequisites: GONE

== 3. Human pastes T1 again to get back to it ==
  files on disk: ["github.com-acme-tools-ci.json"]
  https://github.com/acme/tools-ci  phase=checking-prerequisites stepIndex=0
    verified=[]                         <-- T1 restarts, and T2 is now GONE
```

Note step 3: this is not a one-off loss. The two targets **destroy each other on
every switch**, permanently, with no error and no warning. `findStateForTarget`
cannot save them — it matches on `targetRepoUrl`, and the file it reads has
already been overwritten by the other target.

### Why it matters here specifically

The ticket's own design note makes per-target distinctness a slice-1 property:
"ONE Onboarding topic REUSED across targets; **state is per-target so concurrent
onboardings stay distinct**". The store's header comment says the same ("One
file per target … so concurrent onboardings (slice 3) stay distinct"). Slice 3
is being built on an invariant that does not hold, and the comment asserting it
will be read as settled.

This is the third instance of one root cause — *the durable file is keyed by a
slug of the URL alone* — after bounces #1 and #4. Fixing the key itself ends the
family instead of guarding one more branch.

### Remediation

Make the slug **injective on the normalized URL**. Keep the readable prefix, and
append a short digest of the normalized form:

```ts
export function slugifyTargetRepoUrl(targetRepoUrl: string): string {
  // Aliases of ONE repo that must keep collapsing onto one file.
  const normalized = targetRepoUrl
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const readable = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
  const digest = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${readable}-${digest}`;
}
```

`github.com/acme/tools-ci` → `github.com-acme-tools-ci-24712d5b`. Still legible
for operator debugging, still filesystem-safe, and now collision-free because
the digest is taken over the *unmangled* string. Verified: distinct normalized
URLs never collide, and the `.git` / trailing-slash / scheme aliases still
collapse onto one file (P5b below).

Any injective alternative is fine — this is the shape I verified, not a mandate.

### **P2 must lose its stability clause — this is not optional**

`extension/test/onboardingFacilitator.property.test.js` P2 currently asserts:

```js
assert.equal(slugifyTargetRepoUrl(slug), slug, 'slugify must be stable on its own output');
```

**Delete that one assertion** (keep the rest of P2). A function that appends a
digest of its input cannot be idempotent, so injectivity and that clause are
mathematically incompatible — and injectivity is the load-bearing one: it is what
stops data destruction, whereas the stability clause was defensive and guards a
re-slugging path that does not exist anywhere in the codebase (I grepped; nothing
re-keys an already-slugged value). Do **not** resolve the conflict by weakening
the fix to satisfy the old assertion.

### P5 — the property that would have caught it

Parked at
`backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-P5.property.test.js.parked`;
**append it to `extension/test/onboardingFacilitator.property.test.js`.**

Verified both ways, exactly as bounce #4's properties were:

```
--- against CURRENT slugifyTargetRepoUrl (bounced commit) ---
  FAIL  P5: two distinct target repos never share one durable state file
        Counterexample: [["https://github.com/oc-d82g7/v-j2o8j","https://github.com/oc/d82g7-v-j2o8j"]]
  PASS  P5b: the aliases slugify deliberately collapses still collapse
--- against PROPOSED remediation ---
  PASS  P5
  PASS  P5b
```

One generator warning, because it bit me here: my **first** version of P5 drew
org and repo independently and uniformly, and **passed 4000 runs against this
live defect** — the boundary shift is far too rare under a uniform draw to ever
appear. The parked generator builds the collision by construction (one shared
token stream, split at two different points). This is the same trap P4's own
comment documents; do not "simplify" the generator back to a uniform draw.

---

## D2 (MEDIUM) — any non-state `.json` in the onboarding directory becomes a fake "state", and the handler then throws

`onboardingFacilitatorStateStore.ts:111-121` decides what is a state by
**excluding filenames**, then casts whatever is left without validating it:

```ts
.filter((entry) => entry.endsWith('.json') && entry !== 'last-processed-update.json' && entry !== NO_ACTIVE_UPDATES_FILENAME)
.map((entry) => {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
  return isEnvelope(parsed) ? parsed : { state: parsed as OnboardingFacilitatorState, processedUpdates: {} };
})
```

`isEnvelope` is checked and then **discarded on the false branch** — the `as`
cast asserts a shape nothing verified. Reproduction, with one plausible sibling
file in `.swarmforge/onboarding/`:

```
states seen by the router: [{"lastContractSha":"abc123"}]
THREW: TypeError Cannot read properties of undefined (reading 'replace')
```

The fake state has no `phase`, so `pickActiveOnboardingState`'s
`s.phase !== 'prerequisites-ready'` filter *admits* it; it is selected as the
active onboarding; and the write path calls `slugifyTargetRepoUrl(undefined)`.
There is **no `catch` between that throw and `processMessageUpdate`** in
`telegramFrontDeskBotCore.ts` — I traced it — so the exception escapes the
onboarding delivery path and takes the update batch with it.

**Why this is not hypothetical.** That directory already holds two non-state
files, and each had to be blacklisted by name — `no-active-updates.json` was
added by *this parcel*, in bounce #3's fix. Slices 2 and 3 add contract and
negotiation state next. A deny-list that must be extended for every future
sibling file will be missed exactly once.

### Remediation

Validate by **shape, not filename** — an allow-list, which also makes the
filename exclusions redundant:

```ts
function isFacilitatorState(parsed: unknown): parsed is OnboardingFacilitatorState {
  return typeof parsed === 'object' && parsed !== null
    && typeof (parsed as OnboardingFacilitatorState).targetRepoUrl === 'string'
    && typeof (parsed as OnboardingFacilitatorState).phase === 'string';
}
```

then in the map: envelope → keep; bare state → wrap (the legacy path the comment
describes, now actually checked); anything else → `undefined`, dropped by the
existing filter. Keep the `last-processed-update.json` exclusion if you like it
as a cheap fast path, but correctness must not depend on it. Please pin it with
a unit test that puts a foreign `.json` in the directory and asserts the handler
still answers normally.

---

## What is NOT the problem — do not change these

- **`findStateForTarget`** (bounce #4's fix). Correct. Any existing state for the
  URL resumes at every phase. Leave it exactly as it is.
- **The shared no-active-onboarding guard** (bounce #3's fix):
  `recordNoActiveOnboardingUpdateProcessed`, the `no-active-updates.json` store,
  `targetRepoUrl: undefined` routing in `markOnboardingUpdateDelivered`, the
  single `findProcessedOnboardingUpdate` call covering both branches. Verified
  correct and consistent on the first-attempt and redelivery-retry paths.
- **P1–P4.** All four are sound and non-vacuous. Only P2's *stability* assertion
  goes, and only because D1's fix makes it impossible (see above).
- **`pickActiveOnboardingState`'s `prerequisites-ready` filter.** I checked it
  against D1 and it is *not* a defect: with bounce #4's fix a re-paste resumes,
  so the filter only means a plain reply after the checklist is finished gets the
  "post a repo URL" message. That matches the slice boundary the comment states.
  Observation, not a change request.

## Housekeeping for the rework

Once P1–P5 are all live in `extension/test/onboardingFacilitator.property.test.js`,
delete both parked copies — they are scaffolding that has served its purpose and
would otherwise drift against the live file:

- `backlog/evidence/BL-590-onboardingFacilitator.property.test.js`
- `backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-P5.property.test.js.parked`

The evidence `.md` files stay.

---

Bounced content is reverted out of this branch per BL-490/BL-495 — **revert the
revert BEFORE merging the rework.**

By architect.
