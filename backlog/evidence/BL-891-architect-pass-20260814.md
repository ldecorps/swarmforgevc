# BL-891 architect pass — 2026-08-14 (filling the gate QA found never ran)

## Scope

Received from QA as `merge_and_process QA ee14a3ce6b` — a bounce, but not a
code-defect bounce: `backlog/evidence/BL-891-qa-bounce-20260814.md` D1 found
that no architect-authored commit or merge exists anywhere between coder's
commit and hardener's merge, and the ticket's YAML declares `architect` in
`required_stages:` with no `stage_skip_reasons` entry — a procedural gate
miss, not a defect in the code. QA independently re-verified the
implementation sound (unit/property/wiring suites green, full extension
suite 7585/7585) and requested either a genuine architect pass or a
documented skip reason — no code changes requested.

This is that genuine pass, reviewing coder's `3853956d6` (BL-891: reconcile
the master checkout's local main ref after QA lands) fresh, from scratch,
against Article 1.5 / architect.prompt's Review Order.

Files reviewed (`git show --stat 3853956d6`):
- `swarmforge/scripts/handoffd.bb` (wiring delta)
- `swarmforge/scripts/master_main_reconcile_lib.bb` (new, pure)
- `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` (new)
- `swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb` (new)
- `swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh` (new)

## Checks run (complete inventory, not first-failure-stop)

1. **Pure/impure split (Article 1.5, local-engineering Architecture Rule 7 —
   policy independent of IO, adapters depend inward)** —
   `master_main_reconcile_lib.bb` has zero git/process calls; its only
   effects are a JSON state file via `babashka.fs`/`cheshire`. All git
   operations (`git status --porcelain`, `git merge --no-edit origin/main`,
   `git merge --abort`) live in `handoffd.bb`'s adapter functions
   (`master-main-reconcile-worktree-clean?`, `master-main-reconcile-merge!`),
   injected into `sweep!` as `{:rev-counts! :clean? :merge! :surface!
   :log!}`. This is the exact adapter-injection shape `push_sweep_lib.bb`
   (BL-356) already established for the mirror-image (local→origin)
   direction — same convention reused, not reinvented. Confirmed the pure
   lib is independently unit- and property-testable with no real git
   process (ran below).
2. **Correctness read of the git wiring** — `master-main-reconcile-merge!`
   runs a plain `git merge --no-edit origin/main` (never `--force`,
   `-X ours/theirs`, `reset`, `rebase`, or `stash`, satisfying invariant 1
   literally) and on any nonzero exit immediately runs `git merge --abort`
   before returning `{:success false}`. Traced all three ways plain `git
   merge` can fail against an already-clean tree (verified clean via
   `:clean?` before `:merge!` is ever called): (a) real content conflict —
   `--abort` restores pre-merge state exactly, matches invariant 2; (b)
   "refuse to merge unrelated histories" or similar upfront rejection — no
   `MERGE_HEAD` exists yet, `--abort` no-ops/fails harmlessly, tree was
   never touched; (c) untracked-file-would-be-overwritten — git refuses
   before mutating anything since the entry gate already confirmed a clean
   tracked tree. No path leaves the checkout partially modified. No defect
   found.
2b. **Wiring double-fetch check** — `master-main-reconcile-sweep!` reuses
   `push-sweep-rev-counts!` verbatim for `:rev-counts!` rather than
   fetching a second time per tick; read `push-sweep-rev-counts!` in
   `handoffd.bb` and confirmed it does perform the `git fetch` side effect
   the comment claims, so `origin/main` is current before both the
   ahead/behind read and the later `merge!` call in the same tick. No stale
   read.
3. **Declared invariants (2, per the ticket YAML) — Article "Invariants
   Review"**:
   - Both are encoded as generator-based property tests in
     `master_main_reconcile_lib_property_runner.bb` (coder-authored, per
     BL-654 — architect's job is to verify existence/non-vacuity, not
     author them). Invariant 1 ("only ever moves forward, never
     reset/rebase/stash/force") reduces at the pure-decision layer to
     "`:merge!` fires iff behind>0 AND clean" (an independent oracle,
     `oracle-should-mutate?`, built without calling `sweep!`/
     `reconcile-decision`). Invariant 2 ("surfaced with its reason, never
     partially updated") reduces to "`:surface!` fires iff the tick ends
     blocked" (`oracle-should-surface?`).
   - Non-vacuity confirmed by inspection AND by re-running: both properties
     ship a mutant (ignores-dirty-tree, silent-block) proven to trip the
     oracle before the real implementation is checked — not merely
     asserted.
   - The real-git half of each invariant (local-only commits genuinely
     reachable after a real merge; the tree genuinely byte-identical after
     a real conflict abort) is separately proven against a real git fixture
     by the wiring test, not left to the pure layer alone — read and
     confirmed scenario 02 (`main^2` parent check + both SHAs' ancestry)
     and scenario 03 (SHA unchanged + `git status --porcelain` unchanged +
     no `conflict` outcome logged for a dirty-blocked tick) genuinely
     exercise this, not just assert log lines.
   - Ran independently, all green (below).
4. **Dependency-rule gate (BL-259 hard gate)** —
   `node extension/out/tools/dependency-gate.js` against the parcel's 5
   changed files: all are under `swarmforge/scripts/`, none under
   `extension/src/`. The tool errors immediately (`Can't open
   'swarmforge/scripts/handoffd.bb' for reading`) — depcruise's scan root
   is `extension/`, structurally scoped to the TypeScript module-boundary
   ruleset (view/policy/core/vscode-api edges), with no applicable rule for
   Babashka files. Same structural N/A as prior babashka-only parcels
   (e.g. BL-848's own architect pass). No TS files are in this parcel's
   lineage (`git show --stat 3853956d6` confirms), so there is nothing for
   this gate to check here.
5. **Co-change coupling (BL-255)** — ran `co-change-report.js` against both
   changed non-test files.
   - `master_main_reconcile_lib.bb` (new file): only 1 co-change each with
     its own sibling files introduced in the same commit — below the
     suspected-coupling threshold, expected for a brand-new file.
   - `handoffd.bb`: co-changes broadly with dozens of files (chase/briefing/
     mono-router/push-sweep libs and their tests, `swarmforge.conf`,
     `PIPELINE.md`, etc.) — this is the file's known baseline as the
     daemon every sweep gets wired into (same pattern already documented in
     prior architect passes on this file); nothing in the list is new or
     surprising for this ticket's 1-line `load-file` + cadence-loop
     addition. No cross-boundary coupling (e.g. into webview/UI code, or
     into `extension/src/`) found.
6. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable to this parcel: no tile/webview
   code touched, no VS Code extension code touched at all. `swarmforge/`
   is this project's own maintained fork (local-engineering Architecture
   Rule 2); this is ordinary fork-maintenance work extending the daemon's
   own existing sweep-cadence pattern (BL-356's mirror image), not a
   modification of an externally-driven, unmodified SwarmForge instance —
   no "integrate don't fork" concern.
7. **Property-testing pass (own section)** — the touched pure module
   (`master_main_reconcile_lib.bb`) already carries generator-based
   property coverage for both declared invariants (see #3); no additional
   undeclared-property gap found on this module — `reconcile-decision` and
   `drift-report` are the only other pure functions and both are exercised
   by the property generator's scenario space (behind ∈ {0,1,5,22}, clean?
   ∈ {t,f}) plus direct unit tests in `master_main_reconcile_lib_test_
   runner.bb`. No new property test added; none needed.

## Tests re-run independently (all green)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` →
  ALL TESTS PASS
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  → both non-vacuity mutants confirmed, 500/500 runs, ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  → 9/9 scenarios PASS (drift-report, pure-FF reconcile, no-throw, idempotent
  re-run, genuine two-way divergence with real merge commit, dirty-tree
  block + byte-identical, self-heal on tree-clean)

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. The procedural gate QA flagged is now satisfied by this pass. The
hardener's existing pass (`backlog/evidence/BL-891-hardener-pass-20260814.md`)
stands — no code changed by this review, forwarding unchanged.

By architect.
