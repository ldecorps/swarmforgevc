# Architect pass — BL-574, BL-681, BL-762 (2026-08-08)

## Context

Received `merge_and_process cleaner 4bf486f312` (task name BL-574; cleaner's
batch also covers BL-681 and BL-762 per Article 2.6 — see
`backlog/evidence/BL-574-BL-681-BL-762-cleaner-pass-20260808.md`). Ancestry
confirmed (`git merge-base --is-ancestor 4bf486f312 HEAD`).

Isolated each ticket's own diff against its immediate coder-commit parent to
scope this review precisely:
- BL-681: `15b9ff9dda^..15b9ff9dda` (4 files — pure step-handler wiring).
- BL-574: `15b9ff9dda..495d5df71d` (9 files — prompt_engine_lib.bb +
  agent_runtime_lib.bb + tests).
- BL-762: `495d5df71d..628e6e8a36` (12 files — finish-shift verb + matrix).
- cleaner's own commit `628e6e8a36..4bf486f312`: evidence/doc files only, no
  production change for these three tickets.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` (full-repo scan; the batch
touches no `.ts` files, so a scoped run is a no-op) reports 3 forbidden
`acyclic` edges among `extension/src/tools/telegram-front-desk-bot.ts`,
`telegramCursorOperatorExec.ts`, `telegramCursorOperatorLiveness.ts`.
Confirmed PRE-EXISTING and unrelated to this batch: none of the three files
appear in any of BL-574/681/762's changed-file lists, and the import counts
in `telegram-front-desk-bot.ts` are identical at `15b9ff9dda^` and
`4bf486f312`. Already tracked as `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
No new violation introduced by this batch.

## Co-change report (BL-255)

Ran against all production files touched by the batch
(`bl574PromptEngineFragmentsAdaptersSteps.js`,
`bl681ConsolidationNeverDropsHumanSentenceSteps.js`,
`bl762FinishShiftPhonePathSteps.js`, `specs/pipeline/steps/index.js`,
`agent_runtime_lib.bb`, `prompt_engine_lib.bb`, `finish_shift_lib.sh`,
`lifecycle_matrix.sh`, `stop_ancillary_services.sh`, `finish-shift`). All
reported coupling is either (a) within-ticket (a ticket's own step handler,
lib, and test co-changing — expected) or (b) pre-existing hub-file noise
(`specs/pipeline/steps/index.js` is an append-only registry every ticket
touches; `stop_ancillary_services.sh` legitimately co-changes with the
Telegram front-desk/tunnel files it starts/stops). No unexpected coupling.

## Architecture review

- **Module boundary (BL-574)**: primary implementation stays in
  `prompt_engine_lib.bb`; `extension/src/swarm/promptEngine.ts` (the
  ticket's named TS-mirror boundary) does not exist in this tree and is
  untouched — no duplication risk.
- **Registry-driven adapter selection (BL-574 Observable 3)**: `compose`
  calls `(select-adapter normalized :model model)` with no `case`/`cond`
  branch on provider name in the compose path itself; `select-adapter` is a
  plain map lookup (`@adapter-registry-atom`) with `register-adapter!` as
  the only way to add a provider. Scenario 03 (adapter registered after
  startup) exercises this for real.
- **Constitution fragment immutability (BL-574)**: `stable-bootstrap-prefix`
  (constitution + pipeline) is untouched by the new adapter/cache machinery;
  scenario 02 confirms byte-identical stable-prefix across providers.
- **Compose, don't fork (BL-762)**: `finish_shift_stop_ancillaries` and
  `stop_ancillary_services_main` both dispatch through the same
  `lifecycle_matrix.sh` table and the same `stop_ancillary_component` ->
  `stop_<component>` functions; bedtime is a different *selection* over the
  existing tested stop functions, not a second implementation. Confirmed via
  `git diff` that `stop_ancillary_services.sh`'s refactor is behavior-only
  (functions extracted, dispatcher added, `set -euo pipefail` sourcing leak
  fixed) with no new component-stop logic invented.
- **BL-681** is pure prose/governance: step handlers read the real,
  already-ratified `05_amendments.md` (Article 5.3) and the real
  `specifier.prompt` citation verbatim — spot-checked both files directly;
  every asserted substring is present. No production logic to review.
- Two-layer (tiles/webview vs tmux substrate), extension-host I/O ownership,
  webview storage, and secrets rules are not implicated — this batch touches
  no `extension/src` or webview code.

## Invariants review (BL-633/BL-654)

- **BL-574** — *"Composed prompt output is byte-identical with the fragment
  cache cold, warm, or invalidated."* Property test authored
  (`prompt_engine_fragment_cache_property_runner.bb`), non-vacuity proven at
  authoring time (recorded in `BL-574-coder-pass.md`) and independently
  re-run here: `bb swarmforge/scripts/test/prompt_engine_fragment_cache_property_runner.bb`
  -> **200/200 runs, ALL PROPERTIES HOLD**.
- **BL-681** — *"The clause names no specific role."* Stated non-encodability
  reason (quantifies over one fixed document, not a generator domain) —
  reviewed and accepted; the acceptance scenario checks the exact claim
  directly and non-vacuity was proven by mutating the article substring and
  observing the scenario fail, then restoring.
- **BL-762** — two invariants (exhaustive component x verb classification;
  bedtime never keeps a seat-reviving component running). Both covered by
  executable, non-vacuity-proven tests in `test_finish_shift_lib.sh` (check
  02b: all 10 cells individually removed, each a correctly-attributed loud
  failure; check 03: keep-set / seat-reviving-set empty-intersection
  assertion). Domain is small and finite (5 components x 2 verbs) so
  exhaustive enumeration is the appropriate encoding, not a generated
  property — consistent with this project's property-testing framework
  table (no framework wired for plain bash).

No missing or vacuous property test found for any declared invariant.

## Property-testing pass (undeclared properties)

No additional property-shaped pure module surfaced beyond what's already
covered above. `read-fragment`/`invalidate-fragment` (BL-574) are exercised
by the existing cold/warm/invalidated property; `select-adapter` is a plain
map lookup with no round-trip/idempotence property beyond what scenarios
02/03 already assert as examples. BL-762's shell code has no pinned
property-test framework (per engineering.prompt's tool table) and its two
declared invariants already have exhaustive coverage. Nothing to add.

## Verification re-run

- `bb swarmforge/scripts/test/prompt_engine_fragment_cache_property_runner.bb`
  — 200/200, ALL PROPERTIES HOLD.
- `bash swarmforge/scripts/test/test_prompt_engine_lib.sh` — 1 pre-existing
  failure (`stable prefix under 50KB`), independently confirmed unrelated:
  BL-574's diff touches no constitution/article/prompt content.
- `bash swarmforge/scripts/test/test_finish_shift_lib.sh` — PASS=11 FAIL=0.
- `run_acceptance.sh` for all three feature files:
  BL-681 3/3, BL-574 9/9, BL-762 14/14 — all green.

## Correctness read

Read `prompt_engine_lib.bb`'s new fragment/cache/adapter code,
`agent_runtime_lib.bb`'s thin-delegate adjustment, `finish_shift_lib.sh`,
`lifecycle_matrix.sh`, `stop_ancillary_services.sh`'s refactor, `finish-shift`,
and both `bl574`/`bl762` step handler files end to end. No correctness
defects found. (`finish_shift_verify`'s truthy-means-problem return
convention initially read as inverted at the `finish-shift` call site but
matches this codebase's established `stack_survivor_scan.sh` convention and
is documented in the function's own header comment — not a defect.)

## Conclusion

No violation, no invariant gap, no correctness defect across BL-574, BL-681,
or BL-762. All three forwarded to hardener as their own `git_handoff`s per
Article 2.6, each naming this commit.

By architect.
