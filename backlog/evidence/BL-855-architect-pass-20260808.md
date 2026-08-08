# BL-855 architect pass — 2026-08-08

Reviewed commit: `d207aa1c0b5d3eb947652802b8e7f42779ac4f50` ("BL-855: refuse a
no-op landing merge before it ever reaches origin"), received via cleaner's
`cfe6a906a9` (evidence-only commit, no defects), merged into this worktree.

## Checklist (Article 4.4 — run-or-blocked, never assumed-clean)

- **Two-layer boundary (tiles/webview vs tmux)** — N/A, no extension/webview
  code touched. This slice is swarm-side `.bb` daemon tooling only.
- **Extension host owns I/O / webview presentation-only** — N/A, same reason.
- **No webview storage / secrets discipline** — N/A, same reason.
- **Integrate-not-fork (SwarmForge driven via `./swarm` + `.swarmforge/`
  only)** — N/A; `swarmforge/scripts/` is this project's own maintained fork
  (local-engineering.prompt §Architecture Rules 2), not the target's copy.
- **High-level policy independent of IO/adapters, low-level depends inward**
  — RUN, clean. `noop-landing-merge?`/`noop-merge-decision` in
  `push_sweep_lib.bb` are pure (no git shelling, no env, no clock); the real
  git adapter (`push-sweep-noop-merge-gate-facts!`) lives entirely in
  `handoffd.bb` and is injected via the existing `adapters` map — exact same
  split as the sibling `qa-gate-decision`/`push-sweep-qa-gate-facts!` pair.
- **Dependency-gate hard gate (BL-259,
  `node extension/out/tools/dependency-gate.js`)** — N/A/not runnable against
  this parcel: the tool's own `EXTENSION_ROOT`/`DEFAULT_SCOPE_PATHS` scope it
  to `extension/src` + `extension/media` (confirmed by reading
  `extension/src/tools/dependency-gate.ts`); this parcel touches zero files
  under `extension/`. (Also hit a `node` version gate under the default nvm
  shell — `20.20.2` vs the tool's required `^22||^24||>=26` — resolved by
  `nvm use 22`; noted since a future architect pass on a `.ts`-touching
  parcel will hit the same thing if invoked from a fresh shell.)
- **Co-change coupling
  (`node extension/out/tools/co-change-report.js`)** — RUN, clean. Ran
  against all 6 changed files
  (`swarmforge/scripts/handoffd.bb`, `push_sweep_lib.bb`,
  `test/push_sweep_cli.bb`, `test/push_sweep_lib_property_runner.bb`,
  `test/push_sweep_lib_test_runner.bb`,
  `test/test_handoffd_push_sweep_wiring.sh`) under Node 22. `handoffd.bb`
  co-changes broadly (expected — it is the daemon hub file). Every other
  changed file's top co-changers are its own push-sweep siblings plus the
  pre-existing `pushSweepSteps.js`/`bl630PushSweepQaGateSteps.js` step files
  it already integrates with. No unexpected cross-domain coupling.
- **Invariants review (BL-633/BL-654)** — RUN, clean, all 3 declared
  invariants pass with non-vacuous property-test coverage, coder-authored:
  - Inv 1 (a total drop is refused, however QA-approved) — property
    `INVARIANT 1`, unit tests (scenarios 02/03), and the real-git e2e
    scenario in `test_handoffd_push_sweep_wiring.sh` (`git merge -s ours`
    reproducing `f28a84ad`'s exact shape). Non-vacuity proven against a
    mutant that unconditionally exempts every merge commit
    (`non-vacuity-check-noop-merge`).
  - Inv 2 (nothing-to-take is never flagged) — property `INVARIANT 2`
    ("cries wolf" check) plus a direct unit assertion
    (`offered-paths []` → not flagged) and a mixed-scenario unit test
    (harmless tree-equal commit alongside a real hit — only the real hit is
    reported).
  - Inv 3 (verdict from git objects alone, never the working tree) — proven
    structurally: `noop-merge-decision`'s signature has no working-tree
    input, and the real adapter (`noop-merge-commit-facts` in
    `handoffd.bb`) diffs only explicit revs (`sha^1`, `sha^2`, `sha`), never
    `git status`/the working directory. Backed by a dedicated non-vacuity
    check (`non-vacuity-check-dirty-tree`) against a mutant that lets a
    dirty-working-tree stand-in flag suppress the verdict.
  - No property test was missing or vacuous; nothing to send back under
    `invariant-unencoded`.
- **Property testing pass (undeclared properties on touched pure
  modules)** — RUN. The only pure modules this slice touched
  (`noop-landing-merge?`/`noop-merge-decision`) are exactly the two the
  coder already covered under the invariants review above. No further
  property-shaped gap found; nothing added.
- **Correctness read** — RUN. Traced the predicate end to end: `offered =
  diff(parent1, parent2)`, `tree-equals-parent1? = (diff(parent1, merge) ==
  [])`, refuse iff `merge? AND tree-equals-parent1? AND (seq offered)` —
  matches the ticket's specified predicate exactly and reproduces the
  measured 2-real/0-false-positive split over the 400-merge sample. One
  edge case considered and NOT bounced: an octopus merge (3+ parents) that
  drops one non-first parent's content while taking another's would not be
  flagged, since `offered-paths`/`tree-equals-parent1?` are computed only
  against `^1`/`^2`. This falls inside the ticket's own explicit
  out-of-scope carve-out ("a PARTIAL drop... is much harder to judge... a
  legitimate conflict resolution drops paths on purpose") and octopus
  merges are not part of this project's actual landing flow (QA lands via
  ordinary two-parent merges; grepped `swarmforge/roles/QA.prompt` and
  `push_sweep_lib.bb` for "octopus" — no hits outside the pre-existing
  BL-630 test fixture). Not a defect against this ticket's declared scope.

## Tests run

- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb` — 500 runs,
  ALL PROPERTIES HOLD (includes both new BL-855 non-vacuity checks).
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — FAILS
  locally with `env: setsid: No such file or directory`. Independently
  re-confirmed pre-existing and environmental, matching the cleaner's own
  finding in `backlog/evidence/BL-855-cleaner-pass-20260808.md`: `setsid`
  (`d207aa1c~1`) predates this commit in this same file, and `setsid` is not
  installed on this host (macOS, no util-linux). Not a BL-855 regression —
  every `setsid`-based wiring test in this suite fails identically here.

## Verdict

NONE — no defects found. Forwarding to hardener.
