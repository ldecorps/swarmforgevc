# BL-1315 hardener pass — bounce to coder (2026-08-31)

Complete review inventory (Article 4.4) for the hardener stage. One item found;
recorded below with class, blamed role, and remediation pointer. Everything
else in the checklist ran and passed — recorded as RAN, not assumed clean.

## D1 — invariant 1 violated: a path shared between an unlanded sibling's
tagged commit and a later untagged own-chain commit is dropped entirely

**Class:** behavior (a real, observed wrong output — not merely an
uncovered-but-correct branch).
**Blamed role:** coder (own-paths' exclusion logic, `land_step_lib.bb`,
commit `28e023dd9a`).

### Mechanism

`path-owner-tickets` (land_step_lib.bb:238) computes a path's `owners` set by
running every commit that touched the path through `commit-ticket-id` and
`keep`ing only the non-nil results:

```clojure
(into #{} (keep #(commit-ticket-id root %) commits))
```

An UNTAGGED commit's touch on a path contributes **nothing** to `owners` — it
is indistinguishable from "no commit touched this path at all". `own-paths`'
exclusion cond then only ever sees the TAGGED touches:

```clojure
(and (seq owners)
     (not (contains? owners task-ticket-id))
     (every? unlanded-siblings owners))
```

So when a path is touched by BOTH an unlanded sibling's tagged commit (owner
id in `owners`) AND a later untagged own-chain commit (contributes no id),
`owners` reads as `#{<unlanded-sibling-id>}` only — `every? unlanded-siblings
owners` is true, and the path is excluded. But the path was also genuinely
touched by an own-chain commit, so invariant 1 ("No path the landed ticket's
own chain delivered is ever dropped … whether or not that role's commit names
the ticket") is violated.

This is the same shape scenario 03 already covers (an untagged own commit's
path must never be dropped) — except the path is SHARED with a sibling
instead of exclusive to the own chain. No existing test — not the six
`land_step_lib_test_runner.bb` scenarios, not
`bl1315OwnPathsFullRangeInvariants.property.test.js`'s fast-check generator —
exercises this combination: own paths and sibling paths are always disjoint
filenames throughout (`own/own${i}.txt` vs `sibling/sib${i}.txt` in the
property test; `own.txt`/`coder.txt`/`hardener.txt` vs `sib.txt` in the test
runner). The generator's `ownSpecArb`/`siblingSpecArb` never let a sibling and
an own commit collide on one path, so this interaction was structurally
unreachable by the existing corpus.

### Reproduction (verified live, twice)

```
git checkout -b bl1315-sibling
echo "sibling edit v1" > shared.txt && git commit -m "BL-9002: sibling creates shared file"
git checkout main
git merge --no-ff -m "BL-9001: forward merge (brings in sibling)" bl1315-sibling
echo "own edit v2" > shared.txt && git commit -m "coder: refine shared.txt further (no ticket tag)"

bb -e '(load-file ".../land_step_lib.bb")
       (println (pr-str (land-step-lib/own-paths root commit "BL-9001" #{"BL-9002"})))'
=> {:paths [], :warning nil}
```

`shared.txt` is in the delivered diff (`git diff --name-only origin/main
commit` lists it), touched by both the sibling's tagged commit and the own
untagged commit — and `own-paths` drops it entirely. Landing this tip would
silently lose the coder's own edit to a shared file.

### Regression test added (RED on the coder's commit, proves the gap)

Added scenario 07 to `swarmforge/scripts/test/land_step_lib_test_runner.bb`,
same fixture style as scenarios 01–06, deterministic (not fast-check —
this is a precise, pinned interaction per the "pin a deterministic case"
convention). Confirmed it fails on `28e023dd9a`:

```
FAIL: own-paths (07): a shared path with a later untagged own edit atop
an unlanded sibling's touch is never dropped (invariant 1)
  expected: true
  actual:   false
1 failure(s)
```

No production code was changed — per the hardener's "Does Not Own: do not
introduce new product behavior", this is coder's fix (own-paths' logic, in the
same file coder introduced it in this parcel).

### Suggested direction (not a mandate — coder's call)

`path-owner-tickets` needs to distinguish "no commit touched this path"
(`owners = #{}`, correctly kept) from "at least one touching commit had no
readable ticket id, alongside N commits that did" (currently indistinguishable
from the former, wrongly treated as full sibling attribution when every
*tagged* touch happens to be an unlanded sibling). One route: track whether
`keep` actually dropped anything (`(some? (some nil? (map ...)))` or compare
counts before/after `keep`) and treat "any untagged touch exists" the same as
"the task's own id is present" for exclusion purposes — i.e. exclude a path
only when EVERY touching commit is positively, individually attributed to an
unlanded sibling, with zero untagged touches. The implementer may find a
cleaner formulation; scenario 07 is the executable spec either way.

---

## Everything else in the pass (RAN, not assumed clean)

- `land_step_lib_test_runner.bb`: ran before adding scenario 07 — ALL PASS
  (baseline, matches architect's report). After adding scenario 07: 1 failure
  (D1 above), all pre-existing scenarios (01–06 plus entangled-siblings)
  still pass.
- `uptime` / orphaned-process check before starting: load average 0.04/0.29/1.37
  on this host, no leftover `node --test`/stryker/vitest processes scoped to
  this worktree. No cooldown-gate concerns — Babashka has no mutation tooling
  wired (BL-472), gated only by the test runner above.
- CRAP/DRY: not applicable — this parcel touches no `extension/src/*.ts`
  file (confirmed via `git diff main..HEAD --stat`: land_step_lib.bb,
  its test runner, two property test files under `extension/test/`, two
  acceptance step-handler/fixture files, `specs/pipeline/steps/index.js`).
  Matches the cleaner's and architect's own "not applicable" findings.
- Hand-traced `full-delivered-paths` and `path-attributing-commits`: both
  correctly propagate `nil` (not `[]`) on an unreadable git call, consistent
  with the file's fail-open-refuses convention.
- Hand-traced the "mixed ownership, task's own id present" case (owners
  contains task-ticket-id plus an unlanded sibling on the same path): the
  `every? unlanded-siblings owners` clause already fails on its own here
  (task-ticket-id is never a member of `unlanded-siblings` by construction),
  so `(not (contains? owners task-ticket-id))` is logically redundant with
  it — an equivalent-mutant observation, not a gap; not pursued further.
- Minor, NOT blocking: `commit-ticket-id` collapses "commit subject names no
  ticket" and "the commit itself could not be read" into the same `nil`,
  which `path-owner-tickets`' `keep` then treats identically to "no
  information" either way. A genuinely unreadable commit (as opposed to one
  that is readable and simply untagged) could in principle be silently
  treated as a harmless untagged touch rather than triggering invariant 2's
  refusal. Given `commit-subject` runs `git log -1 --format=%s` on a hash
  `path-attributing-commits` just enumerated from the same repository, this
  requires a mid-walk repository corruption to manifest — far lower
  probability than D1, and not reproduced. Recorded for completeness, not
  escalated as a blocking defect.

## Spec-gap surfaced (for the specifier, NOT part of this bounce)

The ticket's own `qa_e2e_procedure` step 5 ("Fail-loud: … make a commit …
whose subject names no ticket and which touches a path no other commit
touches. Re-run: expect a refusal naming that path…") contradicts invariant 1
and the ticket's own scenario 03 / test-runner scenario 03: an untagged own
commit touching a path exclusive to it (e.g. `coder: implement the feature`
touching `coder.txt`, per scenario 03) is REQUIRED to survive, not refuse —
and that shape is identical to step 5's described repro (untagged commit,
sole toucher of a unique path). Verified live: the shipped `own-paths`
correctly KEEPS such a path (matches invariant 1 and scenario 03), which
means it cannot ALSO refuse per step 5 without breaking invariant 1's own
tested coverage. This looks like a drafting inconsistency in the ticket text
predating the "owners = #{} is positive information, not blindness" design
that the coder's docstring settles on — not something the coder should
implement as literally stated. Per Article 4.4 ("Spec gaps leave by note,
priority 00, never a parcel") this is surfaced here for the specifier to
adjudicate (amend or drop step 5), not folded into the D1 bounce.
