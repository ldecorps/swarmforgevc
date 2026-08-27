# BL-919 architect pass — 2026-08-18

## Scope

Received from cleaner as `merge_and_process cleaner be5ccb3721` (a batch
forward carrying BL-919, BL-625, BL-913 as three separate git_handoffs per
Article 2.6 — this evidence covers only BL-919's own work). The actual
BL-919 implementation is coder's commit `693ea1e99` (`git log
5df9156ad..be5ccb3721` shows it in the merged range); cleaner's own commit
`be5ccb3721` is scoped to BL-913 test-runner cleanup and touches none of
BL-919's files (`git diff 693ea1e99..be5ccb3721 -- swarmforge/scripts/handoffd.bb
swarmforge/scripts/master_main_reconcile_lib.bb
swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb
swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb
swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh` is
empty), so `693ea1e99` is the commit actually reviewed here.

Files reviewed (`git show --stat 693ea1e99`):
- `swarmforge/scripts/handoffd.bb` (wiring delta: two new adapters replacing
  the old `:clean?` boolean adapter)
- `swarmforge/scripts/master_main_reconcile_lib.bb` (pure decision logic
  widened)
- `swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`
- `swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
- `swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`

## Checks run (complete inventory, not first-failure-stop)

1. **Pure/impure split (Article 1.5 / local-engineering Architecture Rule
   7)** — `master_main_reconcile_lib.bb` gained `porcelain-lines->paths`
   (pure text parsing), `overlapping-paths` (pure set intersection), and a
   widened `reconcile-decision` — none shell out or touch the filesystem
   beyond the pre-existing JSON state read/write. All git-specific
   path-gathering (`git status --porcelain`, `git merge-base`, `git diff
   --name-only`) lives in two new `handoffd.bb` adapters
   (`master-main-reconcile-dirty-paths!`, `master-main-reconcile-merge-changed-paths!`),
   injected into `sweep!` exactly like the pre-existing `:rev-counts!`/
   `:merge!` adapters. The split the ticket's own "Shape of the fix" section
   asked for ("the git-specific path-gathering stays behind an adapter,
   matching the lib's existing split") is what shipped.
2. **Correctness read of the new gate logic** — traced `reconcile-decision`
   algebraically against invariant 3: when `dirty-paths` is empty (a clean
   tree, the only case the OLD blanket gate ever let through),
   `overlapping-paths` is empty regardless of `merge-changed-paths`
   (intersection with `#{}` is always `#{}`), and the new
   `unknown-merge-changed` block clause is gated on `(seq dirty-paths)` —
   so a clean tree reaches `:should-reconcile` unconditionally, same as
   before. The new gate can therefore only ever be equal-or-more-permissive
   than the old one; every input the old gate reconciled, the new gate still
   reconciles. No path found where the new logic is stricter than the old.
3. **`merge!` / abort-on-conflict (invariants 1 and 2)** — unchanged by this
   commit (`master-main-reconcile-merge!` in `handoffd.bb` is untouched, verified
   via `git show 693ea1e99` — the merge/abort hunk is not part of the diff).
   Still a plain `git merge --no-edit origin/main` with `git merge --abort`
   on nonzero exit, never `--force`/`reset`/`rebase`/`stash`.
4. **`merge-changed-paths!` correctness** — diffs `git merge-base HEAD
   origin/main` against `origin/main` (not `HEAD..origin/main`, which would
   also pull in paths only local commits touched). This is the same or a
   conservatively wider set than what a real 3-way merge could write to, and
   per the invariant-3 algebra above, extra conservatism here can only
   ever affect the already-blocked (dirty) case, never regress a
   previously-clean-passing input — consistent with the ticket's own
   "if computing the overlap is ever uncertain, refusing is the safe
   answer."
5. **Declared invariants (3, per the ticket YAML) — Invariants Review**:
   - All three are encoded as generator-based property tests in
     `master_main_reconcile_lib_property_runner.bb` (coder-authored, per
     BL-654), each with an independent oracle built without calling
     `reconcile-decision`/`sweep!` directly (`oracle-should-mutate?`,
     `oracle-should-surface?`, and BL-919's own new
     `oracle-old-gate-should-mutate?` for invariant 3).
   - Non-vacuity confirmed by inspection AND by re-running: three
     deliberate mutants (`mutant-ignores-overlap!`, `mutant-silent-block!`,
     `mutant-narrower-than-old-gate!`) each proven to trip their oracle
     before the real implementation is checked.
   - The real-git half (byte-identical non-overlapping dirty file after
     reconcile; named path in the surfaced note; untracked-clash refused
     up front; conflict-abort leaves no in-progress merge) is separately
     proven against a real git fixture by the wiring test — read and
     confirmed each of the 16 scenarios exercises real git state, not
     just log lines.
   - Ran independently, all green (below).
6. **Dependency-rule gate (BL-259 hard gate)** —
   `node extension/out/tools/dependency-gate.js` against the parcel's 5
   changed files: all are under `swarmforge/scripts/`, none under
   `extension/src/`. The tool errors immediately (`Can't open
   'swarmforge/scripts/handoffd.bb' for reading`) — depcruise's scan root is
   `extension/`, scoped to the TypeScript module-boundary ruleset, with no
   applicable rule for Babashka files. Same structural N/A as prior
   babashka-only parcels (e.g. BL-891's own architect pass). No TS files in
   this commit's diff.
7. **Co-change coupling (BL-255)** — ran `co-change-report.js` against both
   changed non-test files.
   - `handoffd.bb` co-changes broadly with dozens of files — this is the
     file's well-documented baseline as the daemon hub every sweep wires
     into (same pattern noted in every prior architect pass touching this
     file); nothing new or cross-boundary (no webview/UI, no
     `extension/src/`) in the list.
   - `master_main_reconcile_lib.bb` was not separately flagged as newly
     coupled beyond its existing sibling test files from BL-891.
8. **Two-layer boundary / host-IO-ownership / webview-storage / secrets /
   integrate-not-fork** — not applicable: no tile/webview code touched, no
   VS Code extension code touched at all. `swarmforge/` is this project's
   own maintained fork; this is ordinary fork-maintenance narrowing an
   existing daemon sweep's gate, not a modification of an
   externally-driven, unmodified SwarmForge instance.
9. **Property-testing pass (own section)** — the touched pure module already
   carries full generator-based coverage for all three declared invariants
   (see #5); the two new pure helpers (`porcelain-lines->paths`,
   `overlapping-paths`) are exercised by the same property generator and by
   direct unit tests in `master_main_reconcile_lib_test_runner.bb`
   (`porcelain-lines->paths` handles renames, blank lines, and short/malformed
   lines; unit-tested directly). No additional undeclared-property gap
   found; no new property test added, none needed.

## Tests re-run independently (all green)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` →
  ALL TESTS PASS
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  → three non-vacuity mutants confirmed, 500/500 runs, ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  → 16/16 scenarios PASS, including all 6 `qa_e2e_procedure` scenarios named
  in the ticket YAML (non-overlapping dirty reconciles; overlapping dirty
  blocks and names the path; untracked clash refused up front; clean-tree
  behavior unchanged; genuine conflict attempted-then-aborted cleanly;
  self-heal on both the overlap and untracked-clash cases).

## Verdict

No architecture violation, no invariant violation, no correctness defect
found. Forwarding to hardender.

By architect.
