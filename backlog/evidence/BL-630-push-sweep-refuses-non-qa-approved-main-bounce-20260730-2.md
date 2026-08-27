# BL-630 architect bounce #2 — 2026-07-30

Commit reviewed: `4f6c74a17` (coder) merged by cleaner into `da315dd549`
("Merge coder BL-630: content-transparent merge-commit fix"), merged
fast-forward into the architect branch (no new architect merge commit — the
architect branch tip already contained this history).

This is the fix for architect bounce #1
(`backlog/evidence/BL-630-push-sweep-refuses-non-qa-approved-main-bounce-20260730.md`,
D1: `git-changed-paths` silently returns zero paths for a merge commit,
permanently jamming `push-sweep!` after any non-fast-forward QA landing).

Complete review inventory (Article 4.4):
- **Dependency-rule gate**: this round's delta (`325add9f38..da315dd549`)
  touches only `swarmforge/scripts/handoffd.bb`, `push_sweep_lib.bb`, and
  `.bb`/`.sh` test files — no TypeScript under `extension/src/`. A full-repo
  scan does report 3 forbidden `acyclic` edges
  (`telegram-front-desk-bot.ts` ↔ `telegramCursorOperatorExec.ts` /
  `telegramCursorOperatorLiveness.ts`), but none of those files are touched
  by this parcel or this bounce round — pre-existing, out of this ticket's
  scope. PASS for this parcel.
- **Co-change**: `handoffd.bb` shows its usual wide fan-in (it is a large,
  frequently-touched file); nothing newly suspicious introduced by this
  round's delta. Informational only, no action.
- **Declared invariant** ("No handoffd tick ever pushes a `main` tip that
  lacks QA approval; every refusal to publish is loud, never silent."):
  the property test (`push_sweep_lib_property_runner.bb`) and unit tests
  (`push_sweep_lib_test_runner.bb`) both pass, and the new real-git wiring
  scenario in `test_handoffd_push_sweep_wiring.sh` (a real `git merge --no-ff`
  landing) passes. All ran green — see D1 below for why "green" does not
  mean "sound" here.
- **Acceptance**: all 5 scenarios in
  `specs/features/BL-630-push-sweep-refuses-non-qa-approved-main.feature`
  still pass (CLI-forced-facts scenarios, unchanged by this round).
- **Correctness read**: found ONE new defect — D1 below. Nothing else.
- No blocked checks. No `spec-gap` items.

## D1 — the merge-commit-transparent fix over-corrects: it blindly trusts
EVERY merge commit's own content, but a merge that resolves a real conflict
can carry content that exists in NEITHER parent and was never independently
QA-approved

- **class**: behavior (correctness defect, invariant violation — the fix
  for architect bounce #1 reintroduces a narrower instance of the exact
  defect this ticket exists to close)
- **blamed role**: coder
- **remediation pointer**: `swarmforge/scripts/handoffd.bb` —
  `git-merge-commit?` / `ahead-commit-facts`; `swarmforge/scripts/push_sweep_lib.bb`
  — `qa-gate-decision`'s `(remove #(or (:qa-ancestor? %) (:merge? %)) ...)`

### The gap

The fix (rightly) noticed that plain `diff-tree` on a merge commit returns
zero paths and that re-diffing per-parent (`-m`) can re-surface *already
QA-checked* content and falsely refuse a routine landing. Its chosen
remedy: tag every commit with 2+ parents `:merge? true` and have
`qa-gate-decision` treat `:merge? true` as **never offending, regardless of
its own content** — the comment states "a merge introduces no independent
content of its own."

That premise is only true for a **clean** merge (no conflicts). It is false
for a merge where a conflict was resolved by hand: git conflict resolution
is edited directly into the merge commit's tree and exists in **neither**
parent's tree. That content is a real code change that never went through
its own commit, was never independently reviewed, and is not itself an
ancestor of `swarmforge-QA` — exactly the class of unreviewed content this
ticket exists to keep off `origin/main`. Because `ahead-commit-facts` now
hard-codes `:changed-paths []` for any 2+-parent sha and `qa-gate-decision`
strips every `:merge? true` entry from consideration before the
bookkeeping-only check even runs, this content is **never checked by
anything** — not by the merge commit (exempted outright) and not by either
parent commit (each parent's own single-parent diff does not contain the
merge's conflict-resolution edits; that content is only visible via a
combined/`-c` diff of the merge itself).

### Empirical proof (real git, not a synthetic-facts mock)

Built a from-scratch repo where a merge is forced to conflict and the
conflict is resolved with content that matches neither side:

```
base:     f.txt = "line1"
feature:  f.txt = "line1-feature-change"      (the QA-approved branch)
main:     f.txt = "line1-main-change"         (unrelated main-side edit)
merge:    git merge --no-ff feature   -> CONFLICT
resolved: f.txt = "line1-CONFLICT-RESOLUTION-NEVER-QA-APPROVED"
```

```
$ git diff-tree --no-commit-id --name-only -r <merge-sha>      # plain, no -m
(0 lines — this is the case the fix now special-cases as :merge? true)

$ git diff-tree --no-commit-id --name-only -c <merge-sha>      # combined diff
f.txt                                                           # <- real, unique content IS detectable this way

$ git show <merge-sha>:f.txt
line1-CONFLICT-RESOLUTION-NEVER-QA-APPROVED

$ git show <feature-sha>:f.txt      # the QA-approved commit's own content
line1-feature-change                                             # <- does NOT contain the merge's resolution text
```

The merge commit carries content — `"line1-CONFLICT-RESOLUTION-NEVER-QA-APPROVED"`
— that is provably absent from every non-merge commit in the ahead range.
Under the shipped fix, this sha is tagged `:merge? true`, so
`qa-gate-decision` never looks at its content and it is waved through
exactly like a trivial, conflict-free merge — a non-QA-approved tip
publishes to `origin/main` silently, with no refusal logged.

### Why the parcel's own tests don't catch it

- `push_sweep_lib_property_runner.bb`'s "independent" oracle
  (`oracle-lacks-qa-approval?`) restates `(and (not merge?) (not
  qa-ancestor?) ...)` — i.e. it bakes in the exact same "merges are never
  offending" premise as the implementation under test. The oracle and the
  implementation share the blind spot, so 500 generated runs can never
  disagree with each other on this exact case; the property is non-vacuous
  for the *bypass-the-gate-entirely* mutant (proven in the file's own
  `non-vacuity-check`) but vacuous specifically for a merge carrying
  conflict-resolution content, because that case is defined out of
  existence by the oracle itself.
- `push_sweep_lib_test_runner.bb`'s new merge-commit unit tests
  (`:merge? true` masking a genuinely offending changed-path) only ever
  feed a synthetic `:changed-paths` alongside a synthetic `:merge? true` —
  they never ask "what if the merge commit's OWN true content differs from
  what any single-parent diff would show."
- `test_handoffd_push_sweep_wiring.sh`'s new real-git scenario builds a
  merge with **no conflicting file at all** (bookkeeping commit on `main`
  touches `backlog/done/...`, feature commit on the QA branch touches
  `extension/src/merge_test.ts` — disjoint paths, so the merge is trivial
  and genuinely does carry zero content of its own). It proves the D1
  jamming bug is fixed; it does not — and structurally cannot, as written —
  exercise a merge that resolves a real conflict.
- No Gherkin scenario in the `.feature` file mentions merge commits at all
  (out of scope at ticket-writing time; this whole class was found on
  review, both bounce #1 and now bounce #2).

### Suggested fix direction (coder's call)

Distinguish a **trivial** merge (its tree is fully reconstructible from its
parents — no conflict was resolved) from a **content-bearing** merge.
`git diff-tree --no-commit-id --name-only -c <sha>` reports paths ONLY when
a file's merge result differs from a trivial combination of the parents
(this is exactly what the empirical proof above relies on) — so a merge
commit with an empty `-c` diff is safe to treat as content-free, while one
with non-empty `-c` output has real content of its own that still needs the
ordinary QA-ancestor/bookkeeping-only check applied to *that* diff.
Whatever the shape, add a real `git merge --no-ff` fixture WITH a forced,
manually-resolved conflict to `test_handoffd_push_sweep_wiring.sh` (mirroring
the trivial-merge scenario already added) proving such a tip is refused —
this exact gap was invisible to every test layer in both rounds of this
parcel, so only a real-git conflict fixture will hold going forward.

## Complete-inventory note

No other defects found this round. No `spec-gap` items. No blocked checks.
Sent back to coder alone (single blamed role); nothing to route to
specifier or coordinator.
