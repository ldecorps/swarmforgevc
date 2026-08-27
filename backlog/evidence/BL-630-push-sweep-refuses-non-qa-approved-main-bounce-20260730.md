# BL-630 architect bounce — 2026-07-30

Commit reviewed: `325add9f38` (coder, "BL-630: push-sweep refuses to publish
a main tip that is not QA-approved"), merged into the architect branch at
`a3c5ef87be`.

Complete review inventory (Article 4.4): dependency-rule gate PASS (full-repo
scan, no forbidden edges — this parcel touches no TypeScript under
`extension/src/`), no new co-change coupling smell, the ticket's one declared
invariant has a non-vacuous property test
(`push_sweep_lib_property_runner.bb`, independent-oracle soundness +
loudness checks, 500 runs, "non-vacuity confirmed" self-check present), all
5 acceptance scenarios pass, the pure unit suite
(`push_sweep_lib_test_runner.bb`) passes, and the real-git wiring proof
(`test_handoffd_push_sweep_wiring.sh`) passes. One item found on the
correctness read below — a defect outside the declared invariant's own
statement, so none of the above gates were positioned to catch it.

## D1 — `git-changed-paths` silently returns zero paths for a merge commit, permanently jamming `push-sweep!` after the first non-fast-forward QA landing

- **class**: behavior (correctness defect spotted on review, not an
  architecture-boundary violation)
- **blamed role**: coder
- **remediation pointer**: `swarmforge/scripts/handoffd.bb`,
  `git-changed-paths` (called from `ahead-commit-facts`, called from
  `push-sweep-qa-gate-facts!`)

### The gap

`git-changed-paths` shells out to:

```
git diff-tree --no-commit-id --name-only -r <sha>
```

Git's own default for this invocation is to show **no paths at all** for a
merge commit (more than one parent) unless `-m`/`-c`/`--cc` is passed — it
does not diff a merge against either parent by default. `commit-bookkeeping-
only?` then reads that empty list as "empty/unknown changed-paths → NOT
bookkeeping-only" (the file's own comment: "A commit whose changed-paths are
empty or unknown is NOT bookkeeping-only"). So **any real merge commit is
unconditionally treated as touching non-bookkeeping paths**, regardless of
what it actually contains.

### Why this is the routine shape, not an edge case

`swarmforge/roles/QA.prompt:117-118` has QA land on `main` with "plain `git
merge`" (not `--ff-only`) — and `git log main --merges` on this repo's own
history shows this is exactly how every QA landing actually happens
whenever `main` has diverged since QA's branch was cut (routine — e.g.
coordinator bookkeeping commits land on `main` directly, so the base
usually has moved by the time QA lands next). A merge commit landed this
way is a **brand-new sha**: it is not itself present in `swarmforge-QA`'s
history, so it fails the gate's fast path
(`tip-is-qa-ancestor?`/`:qa-ancestor?` both false for its own sha) and falls
through to the per-commit changed-paths check — which the diff-tree gap
above answers with `[]`.

### Empirical proof (three independent reproductions)

1. **My own merge commit in this review** (`a3c5ef87be`, "Merge cleaner
   325add9f38 for BL-630 (architect review)", 708 insertions across 9+
   files): `git diff-tree --no-commit-id --name-only -r a3c5ef87be` → **0
   lines**.
2. **A real historical QA landing on this repo's own `main`** —
   `b9e099ade61765edcebb85231e37f48e86fefc47` ("Merge QA-approved BL-688
   (274e66a470) into main"): `git diff-tree --no-commit-id --name-only -r
   b9e099ade` → **0 lines**, vs. `git diff-tree ... -m b9e099ade` → **32
   lines** (the real changed paths, visible only with `-m`).
3. **Minimal from-scratch repro run through the real `qa-gate-decision`
   function** (not a mock): built a throwaway repo where `main` diverges
   (a bookkeeping-style commit lands directly on `main`), cut a feature
   branch from the pre-divergence base, pointed `swarmforge-QA` at it, then
   landed it on `main` via `git merge --no-ff` exactly as QA.prompt
   prescribes. Fed the resulting facts (gathered with the exact same git
   invocations `handoffd.bb`'s adapter uses) into the real, unmodified
   `push-sweep-lib/qa-gate-decision`:

   ```
   tip-is-qa-ancestor?: false
   changed-paths for main-tip (the merge commit): ()

   qa-gate-decision result: {:refuse? true, :reason :non-qa-ancestor,
     :offending-shas ["37218d0a284d6e14d04d7ca7934a20dbeb4a5e18"]}
   ```

   A 100% QA-approved merge landing is refused.

### Why no test in this parcel catches it

- `push_sweep_lib_test_runner.bb` and `push_sweep_lib_property_runner.bb`
  only ever feed synthetic `:changed-paths` straight into the pure
  `qa-gate-decision` — they never call through the real `git-changed-paths`
  adapter.
- `test_handoffd_push_sweep_wiring.sh` (the "real git" proof) only ever
  creates single-parent commits via `git commit`; it never exercises a `git
  merge`.
- All 5 scenarios in `BL-630-push-sweep-refuses-non-qa-approved-main.feature`
  drive the CLI through forced `PUSH_SWEEP_QA_GATE_FACTS` JSON
  (`pushSweepSteps.js`), never real git.

So this gap is invisible to every verification layer this parcel shipped
with.

### Why this matters more than an ordinary bug

BL-631 (alarm/detection on a refused tip) is explicitly out of scope for
this ticket, so a `qa-refused` outcome produces no human-facing alarm today
— it only logs a `push-sweep qa-refused ...` line each tick. Once this gap
fires, `main` silently (from a human's point of view) stops reaching
`origin` **permanently** (the offending merge sha never leaves `origin/
main..main`, so every later tick re-refuses it, and every further commit
piles up behind it) — reproducing, in a new and far more likely-to-trigger
form, the exact "the sweep jammed and a human had to notice and fix it by
hand" failure BL-590's post-mortem exists to prevent. Given `git log main
--merges` shows this is the normal QA-landing shape, this would very
plausibly fire on the first non-fast-forward landing after this ticket
ships.

### Suggested fix direction (coder's call)

`git-changed-paths` needs to account for merge commits — e.g. `git
diff-tree --no-commit-id --name-only -r -m <sha>` (per-parent diff,
proven above to correctly surface the real paths) or an explicit
merge-commit branch in `ahead-commit-facts`. Whatever the shape, add a real
`git merge --no-ff` scenario to `test_handoffd_push_sweep_wiring.sh` (or an
equivalent real-git fixture) proving a genuine QA-approved merge landing
still publishes — this exact gap was invisible to every synthetic-facts
test layer in this parcel, so only a real-git proof will hold going
forward.

## Complete-inventory note

No other defects found. No `spec-gap` items. No blocked checks. Sent back
to coder alone (single blamed role); nothing to route to specifier or
coordinator.
