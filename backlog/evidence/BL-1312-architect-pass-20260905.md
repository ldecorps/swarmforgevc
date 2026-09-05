# BL-1312 — architect pass, 2026-09-05

Ticket: BL-1312-fixture-root-cleanup-does-not-survive-sigterm
Role: architect
Commit reviewed: 88dbaa7f28 (cleaner NONE pass)

## Result: NONE — no architecture, invariant, or correctness defect found

## `required_wiring` note — index.js registration is correctly absent

The ticket's own `notes:` field (written at mint) instructs "REGISTER it
in `specs/pipeline/steps/index.js`", but the ticket's `required_wiring`
entry (repointed 2026-09-04, explicitly noted as post-BL-1371) says "the
handler file IS the registration and index.js names nothing" — these two
parts of the same ticket text disagree, and the `notes:` field is simply
stale. Confirmed directly: `grep -n bl1312 specs/pipeline/steps/index.js`
returns nothing, and `specs/pipeline/steps/index.js`'s own header
documents that it discovers handlers by directory scan
(`readdirSync`-based, BL-1371) rather than a hand-maintained require list.
Running the acceptance feature confirms discovery works with no index.js
edit (below). Not a defect — the coder correctly followed the
authoritative (newer) anchor text over the stale note.

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.` The change is a shared test-fixture helper (used only
  under `specs/pipeline/steps/`, acceptance-runner-side code, not
  production `extension/src`), its one caller-side secondary fix, and new
  step-handler/probe files — no webview, no VS Code API, no secrets, no
  browser storage.
- **Co-change report**: nothing suspicious beyond this ticket's own family
  and the two named offender files' pre-existing regression-test
  co-changes.
- **jscpd**, independently re-run on all four touched/new files: 1 clone,
  entirely inside `roleLifecycleParkUnneededSteps.js` (lines 246-261, 8
  lines / 55 tokens) — confirmed pre-existing by extracting that file's
  content one commit before this ticket's own diff and re-running jscpd
  on it alone: identical clone shape (241-256 pre-diff vs 246-261
  post-diff, same 8-line/55-token size, shifted only by this ticket's own
  6-line insertion). Out of this ticket's scope, correctly left untouched.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family — correctly, this is a fresh defect fix.

## Invariants Review (BL-633/654)

1. **Invariant 1** ("a fixture root is removed on SIGINT/SIGTERM
   regardless of which other step files happen to be loaded") — read
   `installExitHook`: routes `removeStragglers` through `fixtureReaper`'s
   `onAbnormalExit`, the same primitive `track()`/`reap()` already use for
   signal coverage. No private SIGTERM/SIGINT listener was added anywhere
   (`grep -rn "process.on('SIGTERM'\|process.on('SIGINT'"
   specs/pipeline/steps/lib/socketFixtureRoot.js` — none), matching the
   ticket's own explicit warning against a second independent listener.
2. **Invariant 2** ("signal handling stays installed once per process
   however many roots are created") — `onAbnormalExit` delegates to
   `fixtureReaper`'s `installGlobalHandlersOnce`, gated on its own
   `globalHandlersInstalled` flag — read directly, confirms one listener
   set regardless of caller count by construction, not merely by test.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `socketFixtureRoot.js`, reverted `installExitHook` to the
pre-fix bare `process.on('exit', removeStragglers)` form, reran the
acceptance feature: **3 of 4 scenarios failed** — both "not installed"
Outline rows and the listener-count scenario (`expected exactly 1 SIGINT
listener, got 0`) — exactly matching the coder's own claimed non-vacuity
result. Restored the file and confirmed byte-identical via `diff` and
`git status --short` (empty).

## Independently re-verified the substance

- `node specs/pipeline/cli.js
  specs/features/BL-1312-fixture-root-signal-cleanup.feature` — **4/4
  pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-324-per-role-lifecycle-park-unneeded-roles.feature`
  (regression on the edited caller file) — **11/11 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1305-fixture-agent-binary-is-the-stub.feature`
  (the other named offender) — **3/3 pass**.
- `npx vitest run test/socketFixtureShortRootGuard.test.js
  test/bl948SocketGuardLimitParity.test.js test/tmuxReaperGuard.test.js`
  — **34/34 pass**.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl948SocketFixtureInvariants.property.test.js
  test/fixtureReaperLiveSocketGuard.property.test.js
  test/bl1032TmuxReaperScope.property.test.js
  test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js`
  — **11/11 pass**, matching the evidence exactly.

## Blast radius / scope judgment

Human ruled option 1 (fix the shared helper for all callers). Agree with
both the coder's and cleaner's judgment that qa_e2e_procedure step 4 (the
full whole-suite before/after regression sweep across all ~90-96 callers)
is correctly deferred to QA's own gate, not this pass's obligation — the
ticket's own qa_e2e text names it as such, and the representative sample
run here (the two named offender files' own features plus every
unit/property test touching `socketFixtureRoot`/`fixtureReaper`) is
proportionate for architecture review.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
