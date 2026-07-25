# BL-590 — architect SEND BACK #6: the handler and the store disagree on what "the same target" is

**Parcel:** cleaner-forwarded coder rework `c336270e05`, slice 1 — Onboarding
topic + prerequisites state machine.
**Reviewed at:** merge `d3595f69c` on `swarmforge-architect`.
**Bounce #5 is FIXED — both defects, verified. Do not touch either fix.**

**Verdict:** SEND BACK to coder. ONE defect, high severity, destructive, and it
is the FOURTH instance of the resume-identity family (#1 in-flight resume, #4
prerequisites-ready resume, #5 slug injectivity, #6 this). Unlike the previous
three, this one is not a missing branch — it is the two layers holding two
different definitions of target identity. Fixing that ends the family; guarding
one more path does not.

Read "What is NOT the problem" before changing anything.

---

## Bounce #5 is FIXED — verified, keep all of it

**D1 (injective slug) — correct.** `slugifyTargetRepoUrl` now appends an 8-char
sha1 of the normalized URL. The reported collision is gone, confirmed against
the compiled module:

```
github.com-acme-tools-ci-24712d5b   <- https://github.com/acme/tools-ci
github.com-acme-tools-ci-927cb49f   <- https://github.com/acme-tools/ci
```

Removing P2's re-slugging stability clause was the right call and the reasoning
in its replacement comment is exactly right.

**D2 (shape validation) — correct.** `isFacilitatorState` validates
structurally; the `as` cast on the false branch is gone and a foreign sibling
`.json` is now dropped rather than turned into a phase-less fake state.

**P5 / P5b landed faithfully**, including the collision-by-construction
generator. P5b is what made this bounce's defect visible — see below.

**Parcel as received:** compile green, 5967 unit tests pass, 50 property tests
pass, dependency-rule hard gate PASSED (no forbidden edges), co-change report
clean for this change, lineage intact (`c336270e05` is an ancestor).

---

## D3 (HIGH, destroys data): an alias of the same repo URL wipes every verified prerequisite

Two layers, two different notions of "the same target":

| Layer | Decides identity by | Where |
|---|---|---|
| **store** | `slugifyTargetRepoUrl` — a **normalizing** function; aliases of one repo deliberately share ONE file (that is P5b's whole point) | `onboardingFacilitatorStateStore.ts:33,44` |
| **handler** | **raw string equality** on the pasted text | `onboardingFacilitatorState.ts:313`, `findStateForTarget` |

Wherever they disagree, the handler says "new target, mint a fresh state" and
the store says "same target, same file" — so the empty new state is written
**over** the existing one. The write lands on the very file the handler failed
to find.

Reproduced end-to-end through the real compiled shell
(`handleOnboardingFacilitatorMessage`) against a real `.swarmforge/onboarding/`
directory, no source edits, only the Telegram transport stubbed:

```
1) paste https://github.com/acme/widgets  -> prerequisites phase, step "toolchain"
2) toolchain verification pasted          -> step "github-access"
3) github-access verification pasted      -> step "fork-clone"

STATE BEFORE: [{"url":"https://github.com/acme/widgets","step":2,
                "verified":["toolchain","github-access"]}]
files: [ 'github.com-acme-widgets-5da08e0b.json' ]

4) paste https://github.com/acme/widgets.git   (THE SAME REPO)
   -> "Onboarding https://github.com/acme/widgets.git: prerequisites phase, step \"toolchain\""

STATE AFTER : [{"url":"https://github.com/acme/widgets.git","step":0,"verified":[]}]
files: [ 'github.com-acme-widgets-5da08e0b.json' ]      <- the SAME one file

VERIFIED PREREQUISITES SURVIVED? NO - DESTROYED

5) re-paste the canonical https://github.com/acme/widgets
   -> step "toolchain", verified: []                    <- not recoverable
```

Step 5 is the part that matters: this is not a recoverable duplicate. The old
state is gone from disk, so going back to the URL form that worked does not
bring it back. The human redoes all five verifications on the target host.

**The trigger is ordinary, not exotic.** The shrunk counterexample P6 finds is
not even the `.git` form — it is **`http://` vs `https://`** for the same repo.
Every one of these pairs destroys state today:

- `https://github.com/org/repo` then `https://github.com/org/repo.git`
- `https://github.com/org/repo` then `http://github.com/org/repo`
- `https://github.com/org/repo` then `https://github.com/org/repo/`

Each is a form a human plausibly pastes on a second visit — copied from the
browser bar one day, from `git remote -v` the next. Bounce #4 established that
re-pasting the URL is ordinary behaviour that must be safe; this is the same
promise broken through a different door.

Note the irony worth keeping in mind while fixing: **P5b passing is what makes
this destructive.** If aliases did NOT collapse in the store, an alias paste
would merely start a harmless second onboarding in a second file. Because the
store correctly collapses them and the handler does not, the collapse turns a
missed resume into an overwrite. The fix is to make the handler agree with the
store — not to weaken P5b.

### D4 (LOW, same fix): `.git` is stripped before the trailing slash

`slugifyTargetRepoUrl`'s normalization runs `.replace(/\.git$/i,'')` **before**
`.replace(/\/+$/,'')`, so `repo.git/` keeps its `.git` and keys a different file
from `repo.git`:

```
github.com-org-repo-c34fddf8        <- https://github.com/org/repo.git
github.com-org-repo.git-0a202b42    <- https://github.com/org/repo.git/
```

The comment above the function states these aliases "still collapse onto one
file". They do not for this combination. P5b does not cover it (it tests four
forms, not this fifth). Low severity on its own — but it is the same normalizer
D3's fix has to touch, so fix it there rather than filing it separately.

---

## Remediation — verified before writing this

**One identity function, owned by the policy module, used by both layers.**

1. In `onboardingFacilitatorState.ts` (the pure module — target identity is
   policy, not persistence) export a single normalizer, with the strip order
   corrected so `.git/` normalizes like `.git`:

   ```ts
   export function normalizeTargetRepoUrl(targetRepoUrl: string): string {
     return targetRepoUrl
       .trim()
       .replace(/^[a-z]+:\/\//i, '')
       .replace(/\/+$/, '')
       .replace(/\.git$/i, '')
       .replace(/\/+$/, '');
   }
   export function isSameTarget(a: string, b: string): boolean {
     return normalizeTargetRepoUrl(a) === normalizeTargetRepoUrl(b);
   }
   ```

2. `findStateForTarget` compares with `isSameTarget`, not `===`.

3. `slugifyTargetRepoUrl` imports that normalizer instead of carrying its own
   copy of the regexes — the store's filename is then *derived from* the
   policy's identity, so the two cannot drift apart again. Dependency direction
   is inward (adapter → policy), which the gate confirms.

There is exactly ONE comparison site to change — `grep -rn "slugifyTargetRepoUrl\|targetRepoUrl ==="`
over `extension/src`, `specs/`, `swarmforge/scripts/` returns only
`onboardingFacilitatorState.ts:313` plus the store's own two uses.

**Verified on that patch, applied locally and then reverted:**
- P6 (below) flips from FAIL to PASS.
- 5967 unit tests: still green.
- 50 property tests including P5 and P5b: still green — the fix does not split
  legitimate aliases and does not weaken injectivity.
- The end-to-end repro above resumes at step "fork-clone" with both
  verifications intact.

Whether the resumed state keeps the originally-pasted `targetRepoUrl` for
display (it does, with the patch above — `findStateForTarget` returns the
*existing* state) or stores the normalized form is the coder's call; the
displayed URL in `renderStatus` is cosmetic. Identity is not.

---

## Property P6 — park it, then adopt it

`backlog/evidence/BL-590-facilitator-slice1-architect-bounce6-P6.property.test.js.parked`

Append it to `extension/test/onboardingFacilitator.property.test.js` as part of
the fix, exactly as P4 and P5/P5b were adopted. It asserts the agreement
directly, without taking a position on which normalization is right:

> the handler RESUMES a target exactly when the store would REUSE its state file

```
resumed === (slugifyTargetRepoUrl(a) === slugifyTargetRepoUrl(b))
```

That is the invariant this family keeps breaking. Any future change to either
layer's notion of identity that is not mirrored in the other fails P6
immediately.

Generator note, in the same spirit as P4's and P5's: `aliasFormArb` emits only
forms `isLikelyRepoUrl` actually accepts. My first version included the bare
`github.com/org/repo` (borrowed from P5b, where it is fine because `slugify`
never sees a non-URL) and it produced a false failure — the handler had not
taken the URL branch at all. A property that fails for the wrong reason is
worth no more than one that passes for the wrong reason.

Verified non-vacuous: **FAILS** on `c336270e05`, shrinking to
`("https://github.com/a/a", "http://github.com/a/a")`; **PASSES** on the
remediation above.

---

## What is NOT the problem — do not change these

- **Bounce #5's D1 and D2 fixes.** Both correct, both verified above. The
  digest-suffixed slug stays. `isFacilitatorState` stays.
- **P5b and the aliasing it pins.** Collapsing aliases is correct behaviour;
  it is the handler that must learn about it. Do not make the store stop
  collapsing them to "fix" D3 — that trades a data-loss bug for a
  duplicate-onboarding bug and breaks P5b.
- **Bounce #4's `findStateForTarget` (resume at every phase).** Correct. Only
  its *comparison* changes, not its resume-always semantics.
- **`readEnvelope`'s remaining `as` cast (line 98).** Not worth a change: with
  the digest in the filename, that path only ever opens a file this store
  itself wrote atomically. D2's fix was needed for the directory *scan*, which
  reads files nobody promised anything about; the keyed read is not exposed the
  same way.
- **The `git@host:org/repo` scp form not collapsing with `https://host/org/repo`.**
  Deliberate and documented in P5b's comment. Leave it.

## Parcel hygiene (not a reason for this send-back)

The parcel flips the repo-root `package-lock.json`'s `"name"` from
`"swarmforgevc"` to `"cleaner"` — a side effect of running npm at the repo root
inside `.worktrees/cleaner`. That file is a tracked 86-byte stub with
`"packages": {}` and there is no root `package.json`, so it is inert, not
functional — it is not why this parcel is going back. But it is ticket-less
(BL-506) and should not ride to `main`: drop that hunk while reworking.

---

*Architect bounce #6 on BL-590. Not recorded via `record-qa-bounce.js` — that
store is QA-only by construction and pooling architect send-backs into it would
contaminate the QA bounce-rate series (BL-635 tracks adding `--by`). This
evidence file follows the corpus naming convention so the backfill can pick it
up when that lands.*
