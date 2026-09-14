# BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send — hardender review pass, 2026-09-14

1 defect(s) found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: npx vitest run test/socketFixtureShortRootGuard.test.js (whole-tree standing guard sweep)
- **Commit hash**: 60975202ab
- **First error excerpt**: expected zero socket-fixture-root violations under specs/pipeline/steps, found: bl1565CoordinatorNeverReceivesGitHandoffSteps.js: builds or references a control socket but roots its fixture at os.tmpdir()
- **Failure class**: test-infrastructure
- **Expected vs observed**: fixture rooted via lib/socketFixtureRoot.js mkSocketFixtureRoot per BL-948
- **Blamed role**: coder
- **Remediation pointer**: switched initFixture to mkSocketFixtureRoot, shortened FIXTURE_PREFIX, pointed the BL-971 pre-run sweep at SHORT_FIXTURE_BASE

By hardender.

## Detail

- Architect handed off with an explicit NONE (bc2836e629); this pass re-verified
  and found one defect via the whole-tree standing guard sweep this parcel's own
  new files require (both `specs/pipeline/steps/` and `extension/test/` were
  touched — the rule "A parcel that touches specs/pipeline/steps/ or
  extension/test/ runs the standing whole-tree guards", this prompt).
- `cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')`
  — 18 guard files, 183 tests: 1 failed (`socketFixtureShortRootGuard.test.js`)
  before the fix, 18/18 (183/183) after.
- Root cause: `bl1565CoordinatorNeverReceivesGitHandoffSteps.js`'s `initFixture()`
  wrote a placeholder `.swarmforge/tmux-socket` pointer file under a fixture
  rooted at `fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX))`. BL-948's
  guard refuses any step file that builds or references a tmux-socket path
  while rooted at the long macOS `os.tmpdir()` base, whether or not the socket
  is ever live — the placeholder here is never a real server, but the guard's
  contract is about the path shape, not liveness.
- Fix: switched to `lib/socketFixtureRoot.js`'s `mkSocketFixtureRoot`
  (shortened `FIXTURE_PREFIX` from `aps-bl1565-coordinator-refused-` to
  `bl1565-coord-` to fit its own headroom assertion), and pointed the BL-971
  pre-run stale-fixture sweep at the same `SHORT_FIXTURE_BASE` the helper
  uses. Committed `60975202ab`.
- Hand-authored mutation sweep (BL-638/BL-567 fallback — no Stryker/CRAP/DRY
  wired for Babashka, BL-472 deferred; ticket's own `mutation_cost: low` note
  confirms no `extension/src` touched) on
  `swarmforge/scripts/git_handoff_recipient_guard_lib.bb`'s `decide`, each
  applied to the live file (no detached job outstanding), test-suite run,
  then restored (`git diff --stat` clean after every restore):
  - `and` → `or` in the top-level `if` — killed
    (`test_swarm_handoff_refuses_coordinator_git_handoff.sh` scenario 03).
  - `some` → `every?` on the recipients fold (the
    "predicate the caller FOLDS over a collection needs a fixture whose
    members DISAGREE" rule — recipients `["architect" "coordinator"]`
    disagree) — killed (scenario 02).
  - `"coordinator"` → `"Coordinator"` string literal — killed (scenario 01).
  - `:refuse`/`:allow` branch bodies swapped — killed (scenario 01).
  All four non-equivalent, all killed by the real test suite, not by a
  hand-reasoned proxy.
- Re-ran clean after the fix: `test_swarm_handoff_refuses_coordinator_git_handoff.sh`,
  `test_swarm_handoff_bounce_never_stamped.sh`, `test_handoff_state_dir_worktree_root.sh`
  (all ALL PASS); `bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js`
  (3/3, `npx vitest run --config vitest.properties.config.mjs`); the BL-1565/
  BL-1536/BL-950 acceptance features via `run_acceptance.sh` (9/9, 5/5, 2/2 —
  matching the architect's own evidence figures exactly); `gherkin_lint_gate.sh`
  clean on all three feature files (one file per invocation — the script takes
  one feature plus an optional repo-root, not a file list); both registration
  guards (`test_check_test_file_registration.sh`,
  `test_check_feature_handler_registration.sh`) ALL PASS.
- Reachability note (not a defect, no action taken): `swarm_handoff.bb`'s
  second `git-handoff-recipient-guard-lib/decide` call (line ~1194, on the
  post-routing recipient set) is provably unreachable-to-refuse given the
  current code — the first call already refuses any git_handoff draft naming
  `coordinator` before `route-required-stages` ever runs, `validate-recipients`
  parses `to:` identically to the raw split checked first (no case
  normalization, no dedup removal), and `required_stages_lib.bb`'s
  `normalize-token` maps `coordinator` to `nil` so routing can never
  introduce it. This is the ticket's own explicit "decide on both" direction
  (defense-in-depth against a future required_stages_lib change), not an
  oversight — left as designed, recorded here per the reachability discipline
  this prompt requires (BL-753's shape) rather than silently passed over.
- No orphaned `node --test`/`stryker`/`tmux -S` processes before or after this
  pass (`pgrep -fl 'node --test|stryker'` empty both times; `pgrep -af
  '[t]mux -S'` count unchanged at 5, all pre-existing and unrelated — this
  fixture never starts a real tmux server). No leftover fixture dirs under
  `/tmp/bl1565-coord-*` after the run.

By hardender.
