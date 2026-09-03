# BL-1328 hardener pass — 2026-09-03

Merged architect commit `23408dcc5d` (clean sweep, no defect) onto this
worktree — clean merge, no conflicts.

## Babashka/shell, no-tooling posture (engineering.prompt, Startup Tools)
Production fix is entirely `.sh` (`swarmforge.sh`'s
`extra_cli_targets_qwen_cloud` plus its two call-site comments) — no
Stryker/CRAP/DRY wired. Gated by its own suite, re-run here:
`./swarmforge/scripts/test/test_bl1328_qwen_model_token_forms.sh`
(zsh shebang, not bash — same as architect's re-run) — 11/11 pass.

## Re-run independently
- `node specs/pipeline/cli.js
  specs/features/BL-1328-qwen-cloud-model-detection-equals-form-and-precedence-doc.feature`
  — 4/4 pass.
- `node specs/pipeline/cli.js
  specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature`
  — 10/10 pass (post-retirement, unchanged).
- `node specs/pipeline/cli.js specs/features/BL-1330*.feature` — 12/12
  pass (the collateral regex-window widening in
  `bl1330SwarmStampBobAnthropicStartingCastSteps.js` didn't regress
  anything).
- `npx vitest run --config vitest.properties.config.mjs
  bl1328QwenModelTokenFormsInvariants
  bl1324ClaudeSeatQwenCloudContextWindowInvariants` — 3 consecutive
  runs, 6/6 each.

## BL-113 Gherkin soft mutation — including the flagged BL-1324 manifest regen
One `Scenario Outline:` in BL-1328's own feature. Ran fresh (`mktemp
-d`, deleted after): **6/6 killed, 0 survived, 0 errors**.

**Per the architect's explicit carry-forward note**: BL-1328's
retirement of one BL-1324 Examples row (`--model=qwen3.8-max --effort
high | false`, correctly retired with a comment and successor pointer,
never flipped — confirmed by reading the diff, not the narrative)
invalidated BL-1324's own `acceptance-mutation-manifest`
`scenario_hash`. Re-ran BL-113 on
`specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature`:
soft mode correctly detected the hash mismatch (stale manifest predates
the retirement) and re-tested for real — **6/6 killed, 0 survived, 0
errors** (down from the stale manifest's 8, matching the one retired
row). New stamp committed, `tested_at` and `mutation_count: 6` both
current.

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/` and `extension/test/`. Same 3
pre-existing, already-ticketed failures as this session's earlier
passes (BL-1289/1290/1291) — confirmed by reading each guard's
violation list, none naming a file this ticket touches.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
No new defect found in this parcel's own diff. The one action this pass
owned — regenerating BL-1324's mutation manifest after BL-1328's
retirement — is done, verified clean. Forwarding to documenter.
