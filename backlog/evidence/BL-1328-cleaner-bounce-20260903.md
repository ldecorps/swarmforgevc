# BL-1328 — cleaner bounce (2026-09-03)

## Review pass completed before this bounce (Article 4.4 — complete inventory)

- Merged coder `fbf4c31003` into cleaner worktree; confirmed the diff's
  scope: `swarmforge.sh` (the equals-form check + both precedence
  comments), BL-1328's own step/property/bb test files, plus two
  disclosed, well-documented collateral repairs to BL-1324's/BL-1330's
  review harnesses (a byte-exact pin BL-1328's own required doc-comment
  addition would otherwise break, and a regex proximity window BL-1330's
  own comment addition pushed past). Both collateral changes are
  legitimate — reasoned, measured, and directly necessitated by this
  ticket's own required changes.
- `run_acceptance.sh specs/features/BL-1328-…feature` — 4/4 pass.
- `./swarmforge/scripts/test/test_bl1328_qwen_model_token_forms.sh` (run
  correctly per its own zsh shebang, not `bash` — my first invocation
  error, not a defect) — ALL PASS, 11/11.
- `npx vitest run --config vitest.properties.config.mjs
  bl1328QwenModelTokenFormsInvariants` — 15 consecutive green runs.
- `npx vitest run --config vitest.properties.config.mjs
  bl1324ClaudeSeatQwenCloudContextWindowInvariants` — 3/3 pass (the
  property test's own decoy list was correctly updated to drop
  `--model=${qwen}`, since it is no longer a decoy).
- `run_acceptance.sh specs/features/BL-1330*` — 12/12 pass.
- Mutation-site advisory (BL-485): step/property files at 169/173 sites,
  consistent with this session's range — no split warranted.
- `run_acceptance.sh specs/features/BL-1324*` — **1 of 11 FAILED**. This
  is the one defect (`D1`) below.

## D1 — BL-1324's own feature file still asserts the pre-fix (buggy) behavior

- **File**: `specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature`
- **Class**: stale acceptance scenario (Gherkin), not owned by cleaner —
  "Does Not Own: create, run, or maintain … Gherkin" in the cleaner role
  prompt.
- **Blamed role**: coder. BL-1328's own invariant 1 states plainly:
  "`extra_cli_targets_qwen_cloud` detects a qwen* model whether the CLI's
  `--model` value arrives as a separate token pair … or a single
  `--model=qwen*` token — both forms are treated identically everywhere
  the function is called." That is exactly what shipped in
  `swarmforge.sh`. But BL-1324's own Scenario Outline (line 33) still
  reads:
  ```
  | --model=qwen3.8-max --effort high        | false  |
  ```
  which was correct BEFORE this ticket (the dormant gap BL-1328 exists to
  close) and is now factually wrong — the function now returns `true` for
  that input, which is the intended fix, not a regression in the
  implementation.
- **Failure scenario**: `run_acceptance.sh specs/features/BL-1324*`
  scenario "extra_cli_targets_qwen_cloud detects a qwen* --model token
  [4]" fails: `extra_cli_targets_qwen_cloud("--model=qwen3.8-max --effort
  high") returned true` vs. expected `false`.
- **Reproduction**: `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1324*` — 10 pass / 1 fail, deterministic (not flaky —
  re-ran twice, same result both times).
- **Root cause, read not guessed**: the coder updated the OTHER two
  places this same "equals form used to be a decoy" fact lives —
  `bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js`'s
  `siblingSeat` decoy generator (removed `--model=${qwen}`, swapped in
  `--model-name ${qwen}`) and the step file's byte-exact-pin relaxation —
  but missed the THIRD place: the static Examples table in BL-1324's own
  `.feature` file, which is a plain data table a sweep for the changed
  predicate's call sites would not surface (it is a literal string in a
  Gherkin table, not a code reference to the function).
- **Consequence if forwarded unfixed**: architect, hardener, and QA would
  each inherit a real, deterministic red in a sibling ticket's acceptance
  suite — not a flake, an assertion of behavior BL-1328 is explicitly
  supposed to change.
- **Remediation pointer**: change line 33 of
  `specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature`
  from `| --model=qwen3.8-max --effort high        | false  |` to
  `| --model=qwen3.8-max --effort high        | true   |` (or otherwise
  fold it into the `true` row if IR-DRY flags a resulting duplicate),
  matching what the property test's own decoy-generator change and the
  ticket's invariant 1 already say is correct. Given BL-1324 is a stamp-off
  whose mutation manifest may be keyed to this scenario, the coder should
  also check whether `mutation-stamp`/`acceptance-mutation-manifest`
  headers at the top of that feature file need regenerating after the
  edit — not assumed here.

## Nothing else found

D1 is the sole defect from this pass; everything else (BL-1328's own
suite, BL-1330's suite, both property tests, mutation-site advisory) is
clean and does not need to be re-run once D1 is fixed.

## Action taken

The bounced commit `fbf4c31003` was not yet an ancestor of `main`, so per
the bounce-revert rule its merge on this branch was reverted.
