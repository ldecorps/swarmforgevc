# BL-622 — architect pass, 2026-08-06

Reviewed commit: 6d5b1fb5 (merge of cleaner's d77da209bb into swarmforge-architect)

## Dependency-rule gate (Article 1.5 REQUIRED HARD GATE, BL-259)
`node extension/out/tools/dependency-gate.js test/bl622TelegramTokenSeparationInvariant.property.test.js`
(cwd extension/, the only parcel file under extension/) — PASSED, no forbidden edges.
Full-repo scan (no args) shows a pre-existing `acyclic` violation among
`telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts` — none of these files are touched by this
parcel (`git diff --name-only c3994d5984^ d77da209bb -- extension/` shows only
the property test file), so this is out of scope for BL-622, not a new
violation introduced here.

## Co-change / logical coupling (BL-255)
`node extension/out/tools/co-change-report.js <every BL-622 changed file>` —
run and reviewed. `specs/pipeline/steps/index.js` shows many
SUSPECTED COUPLING entries; this is the append-only step-handler registry
every acceptance-adding ticket touches by design, not new coupling
introduced by this parcel. No other flagged pair judged as a real coupling
concern.

## Invariants review (BL-633/BL-654)
Ticket declares one invariant. `extension/test/bl622TelegramTokenSeparationInvariant.property.test.js`
encodes it as two independent, non-vacuous fast-check properties driving the
REAL `fleet_telegram_creds_lib.bb` (via `fleet_telegram_creds_cli.bb` / a
thin conflict-check script), never a JS reimplementation of the decision:
- Property A: env-fallback resolution is refused iff not the recorded
  primary root and no own creds file — oracle derived independently from
  the invariant wording.
- Property B: cross-swarm token uniqueness — a swarm is flagged as
  conflicting iff another fleet swarm's own creds file carries the
  byte-identical token; collisions are constructed, not left to luck; a
  nil token asserted to never conflict.
Both ran green under the project's real runner:
`npx vitest run --config vitest.properties.config.mjs bl622TelegramTokenSeparationInvariant`
→ 2/2 passed.

## Architecture rules checked
- Secrets: fleet creds file and the new primary-root record both live under
  `home-dir` (`~/.swarmforge/fleet/...`), always an explicit parameter never
  read internally — never written into the target working tree or a commit.
- Two-layer boundary (tiles/webview vs tmux substrate): not implicated —
  this parcel is entirely within the `swarmforge/` maintained-fork script
  layer (Local Engineering Architecture Rule 2) plus one JS property test
  and step-handler file; no VS Code API / webview surface touched.
- Integrate-not-fork: modifications are to this repo's own tracked
  `swarmforge/` fork, the legitimate place for this class of change.

## Verification run (spot check, not a replacement for hardener/QA's own pass)
- `bb swarmforge/scripts/test/fleet_telegram_creds_lib_test_runner.bb` — ALL TESTS PASSED
- `bash swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh` — ALL CHECKS PASSED, exit 0
- `bash swarmforge/scripts/test/test_launch_front_desk.sh` — ALL CHECKS PASSED, but see Finding below
- `node specs/pipeline/cli.js specs/features/BL-622-onboarding-telegram-token-separation.feature` — 7/7 scenarios pass (TAP)

## Finding (non-blocking, filed as rule_proposal, not a bounce)
`swarmforge/scripts/test/test_launch_front_desk.sh` exits 1 despite printing
"ALL CHECKS PASSED" (0 fixture-provisioning failures). Root cause: every
fixture is created via `F="$(make_fixture)"` command substitution, so
`register_tmp_dir` (called inside `make_fixture`) only ever mutates a
subshell-local copy of `tmp_cleanup.sh`'s `__SWARMFORGE_TMP_DIRS_TO_CLEAN`
array — the parent script's array stays permanently empty. On this host's
bash 3.2.57 (macOS default), `"${arr[@]}"` on a truly empty array under
`set -u` throws "unbound variable" in the EXIT trap, forcing exit 1
regardless of actual check outcomes, and every fixture dir silently leaks
(never cleaned).

This predates BL-622: `make_fixture`/the `X="$(make_fixture)"` idiom in this
file was not touched by BL-622's diff (only two `check` blocks were
rewritten), and the same pattern recurs in other `test_*.sh` harnesses using
`tmp_cleanup.sh`. Not a defect in this parcel — filed as a `rule_proposal`
to specifier/coordinator, not a bounce. `test_front_desk_supervisor_bl622_refusal.sh`
is unaffected (it also calls `register_tmp_dir` directly, outside any
subshell, for at least one dir per scenario, so its array is never empty).

## Verdict
COMPLIANT. Forwarding to hardener.
