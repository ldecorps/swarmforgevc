# BL-919 / BL-625 / BL-913 — hardener pass (batch of 3), 2026-08-18

## Scope

Batch of 3 items received via `ready_for_next.sh`, all merged into this
worktree with plain `git merge --no-ff` (no `reset --hard`, no
`checkout -- .`):

1. BL-919, `merge_and_process architect 547b46c016` — master-main reconcile
   narrows its dirty gate to overlap-only (coder `693ea1e99`, cleaner
   no-op on these files, architect clean review).
2. BL-625, `merge_and_process architect 17be5c74ad` — onboarder slice 3
   (prompts CLI, launch handoff, done, topic reuse; coder `b94870c00`,
   architect clean review).
3. BL-913, `merge_and_process architect dd87fb8083` — pinned shell + one
   classified retry (coder `df92bab8d`, cleaner
   `be5ccb3721` fixed temp-dir cleanup in the tool-miss-heal test runners,
   architect clean review of both).

Each architect evidence file (`backlog/evidence/BL-919-...20260818.md`,
`BL-625-...20260818.md`, `BL-913-...20260818.md`) is a complete, independent
review; this pass re-runs every test suite independently rather than trusting
those results, per Article 4.4.

## Complete review inventory (Article 4.4 — one pass, everything run)

- Orphaned processes / leaked fixture tmux servers before starting:
  `pgrep -fl 'node --test|stryker|vitest'` clean; `pgrep -afl tmux` showed
  only the live swarm's own sockets under `.swarmforge/tmux/` and
  `.swarmforge/operator/` — no fixture leak (checked by socket path, not
  session name).
- BL-149 cooldown gate: all 5 changed `extension/src/*.ts` files are
  `skip-cooldown` (all <3 days old) — Stryker mutation deferred to a later
  quiet pass per policy, not run this round. All changed `.bb` files have no
  mutation tool wired regardless (engineering.prompt Startup Tools);
  Babashka's own unit/property/wiring suites are the gate.

### BL-919 (Babashka, degraded CRAP/DRY gating — no tool wired for `.bb`)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` →
  ALL TESTS PASS (independently re-run).
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  → 500/500 runs, ALL PROPERTIES HOLD, all three declared invariants'
  non-vacuity independently reconfirmed (own oracle output, not taken on
  the architect's word).
- `bash swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  → 16/16 scenarios PASS, including all 6 `qa_e2e_procedure` scenarios named
  in the ticket YAML.
- No `required_wiring:` declared (per the ticket's own notes, correctly —
  no new call site this ticket adds). Acceptance is a `.feature.draft` by
  design (BL-233 — the JS runner cannot bind a Babashka daemon sweep); no
  BL-113 Gherkin mutation applies.

### BL-625 (TypeScript — CRAP + DRY in scope; Stryker deferred per BL-149 cooldown)

- `npm run compile` — clean, no type errors (before AND after this pass's
  own CRAP-fix edits).
- Full unit suite with coverage, `npx vitest run --coverage` — 437/437 test
  files, 7755/7755 tests PASS (one unrelated flake on the first attempt,
  `test/renderBriefingDiagramsCli.test.js`, timed out at 20s under host
  load 20+/4 cores at that moment; re-ran standalone at 8.7s once load
  settled — confirmed a load-induced flake, not a regression, and the file
  is untouched by this batch's diff; full suite re-run clean at 0 failures
  after).
- Targeted re-run of this ticket's own suites:
  `npx vitest run test/contractPhaseRelay.test.js
  test/onboarderContractPhaseRouter.test.js
  test/telegramFrontDeskBotCli.test.js` — 305/305 PASS.
- Properties (kept separate from unit/coverage, per policy):
  `npx vitest run --config vitest.properties.config.mjs
  test/onboarderAmbiguousTargetRefusal.property.test.js
  test/onboarderContractPhaseRedeliveryIdempotent.property.test.js` — 4/4
  PASS, including both invariants' own non-vacuity mutant checks.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-625-onboarding-facilitator-prompts-and-launch-handoff.feature`
  — 5/5 scenarios PASS. No `Scenario Outline:` in this feature (only plain
  `Scenario:` blocks) — BL-638 applies, BL-113 Gherkin mutation is
  inapplicable, not skipped.
- DRY (`npm run dry`): 35 clones found, identical count before and after
  this pass's edits (confirmed via `git stash`/`git stash pop` A-B
  comparison) — no new duplication in any of BL-625's changed files.
- **CRAP defect found and fixed this pass** (see below).

### BL-913 (Babashka core + a live `.feature` with a Scenario Outline)

- `bb swarmforge/scripts/test/tool_miss_heal_lib_test_runner.bb` → ALL
  TESTS PASS (independently re-run).
- `bb swarmforge/scripts/test/tool_miss_heal_lib_property_runner.bb` → ALL
  PROPERTIES HOLD, invariant 1's non-vacuity mutant reconfirmed.
- `bash swarmforge/scripts/test/test_tool_miss_heal_hook_wiring.sh` → 7/7
  scenarios PASS.
- `XDG_RUNTIME_DIR=<short dir> bash
  swarmforge/scripts/test/test_model_factory_runtime_wiring.sh` → 7/7
  PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-913-pinned-shell-and-one-classified-retry.feature` —
  6/6 concrete cases PASS.
- **BL-113 soft Gherkin acceptance mutation** (owned by this role):
  ```
  specs/pipeline/scripts/run_gherkin_mutation.sh \
    specs/features/BL-913-pinned-shell-and-one-classified-retry.feature "" \
    specs/pipeline/steps/bl913PinnedShellClassifiedRetrySteps.js soft
  ```
  Result: 6 mutants generated across the one `Scenario Outline:`, **all 6
  killed, 0 survived, 0 errors**, real elapsed 9.3s with genuine per-mutant
  TAP assertion failures (not a crash-fake — verified the captured output
  names the actual mismatched value each time, e.g. `KNOWN_VALUES says "the
  role's own worktree"`), confirming the step handler's own
  `KNOWN_MISS_ENVIRONMENTS` pin (already wired by the coder per the
  2026-08-17 rule_proposal accepted into this role's own prompt) genuinely
  keys off the `<miss>`/`<healed environment>` Examples cells rather than
  scenario shape. Manifest stamped into the feature file
  (`mutation-stamp` + `acceptance-mutation-manifest-begin/end`), committed
  in this pass's own commit.
- No BL-788 cross-step bridge-leak hazard: the step file never calls
  `startBridge`, confirmed by grep before running mutation.

## CRAP defect found and fixed (BL-625)

`node scripts/crapReport.js` against BL-625's 5 changed `src/*.ts` files
flagged 4 functions this ticket's own diff pushed (or kept) over the CRAP<=6
threshold, all in files this ticket actually modified:

- `decideContractPhaseAction` (contractPhaseRelay.ts): complexity 11 —
  three new `if (phase === X) { return PROCEED_PATTERN.test(text) ? ... :
  unrecognized }` branches, each following the identical
  proceed-advances-one-phase shape already used by the pre-existing
  `prerequisites-ready` branch.
- `runContractPhaseAction` (contractPhaseRelay.ts): complexity 9 — an
  8-case `switch` over `action.kind` (the CRAP tool counts each
  `CaseClause` as its own decision point).
- `renderUnrecognized` (contractPhaseRelay.ts): complexity 7.01 (94%
  covered) — 5 sequential `if (phase === X) return <message>` branches.
- `handleOnboarderMessage` (telegram-front-desk-bot.ts): complexity 8 — the
  ticket's own 1-line addition (`|| outcome.kind === 'ambiguous-target'`)
  pushed an already-borderline redelivery-guard-plus-dispatch function over
  the line.

Fix (behavior-preserving; hardener's own "make behavior-preserving splits
so code is testable" duty, not new product behavior):

- `decideContractPhaseAction` and `renderUnrecognized`: replaced the
  per-phase `if`/ternary chains with `Partial<Record<OnboardingPhase, ...>>`
  lookup tables (`PROCEED_ADVANCE_ACTION`, `UNRECOGNIZED_MESSAGE_BY_PHASE`)
  — a future phase costs one table row, not one more branch.
- `runContractPhaseAction`: replaced the `switch` with an
  `ACTION_HANDLERS` lookup table for the 6 payload-free action kinds, plus
  one `if` for `negotiate-object` (the sole variant carrying its own
  payload, kept as an explicit branch rather than forced into the table).
- `handleOnboarderMessage`: extracted the self-contained
  redelivery-accounting branch into its own `respondToProcessedUpdate`
  helper (mirrors this file's own pre-existing
  `decideNegotiationPhaseAction` extraction, done in a prior hardener CRAP
  pass on BL-624).

Re-ran `npm run compile` (clean), the full coverage suite (7755/7755
green), the three targeted test files (305/305), the property lane (4/4)
and the acceptance feature (5/5) after these edits — all still pass
unchanged. Re-ran `npm run dry` — clone count unchanged (35).

Re-ran `node scripts/crapReport.js` against the same 5 files after the fix:
all four now under threshold. The tool's remaining 3 flags in
`telegram-front-desk-bot.ts` (`candidateApprovalsTopicIds`,
`sendApprovalAsk`, `executeSharedOperator`, `conciergeTickLoopWithScheduler`,
`ensureApprovalsTopic`) and 1 in `contractPhaseRealAdapters.ts`
(`defaultSurveyRepo`) are pre-existing debt, confirmed untouched by this
batch's diff (`git diff 5df9156ad..b94870c00` for each file) — out of scope
here per Article 4.3 (route to the role that owns the file's change, not a
send-back for debt this ticket did not introduce).

**`routeOnboardingMessage` (onboarderContractPhaseRouter.ts) — investigated,
no change needed.** The full-suite coverage run flagged it at CRAP=6.02
(complexity 6, 92% covered) — one branch (`if (ambiguousMessage) return
{kind: 'ambiguous-target', ...}`, line 117-119) showed 0 hits despite a
dedicated test explicitly exercising it
(`test/onboarderContractPhaseRouter.test.js:170`, "routeOnboardingMessage
refuses an unattributable reply as ambiguous-target..."). Re-ran that test
file alone with coverage: the same branch shows 8/8 hits, 100% covered,
CRAP=6.00 — confirming the 0 in the full-suite run was a coverage-merge
artifact from the large parallel multi-file run, not a real gap. No test
gap and no source change warranted.

## Verdict

All three tickets are clean. BL-919 and BL-913's Babashka core is fully
re-verified with all invariants' non-vacuity independently reconfirmed.
BL-913's Scenario Outline is mutation-clean (6/6 killed). BL-625's one real
finding (CRAP debt this ticket's own diff introduced) is fixed
behavior-preservingly and re-verified green. Forwarding all three to
documenter, each under its own task name (Article 2.6 — multi-ticket
batch, one `git_handoff` per ticket, same commit `619fe5226`).

By hardener.
