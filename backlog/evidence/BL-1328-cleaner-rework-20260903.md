# BL-1328 — cleaner re-review after bounce D1 (2026-09-03)

## D1 verified fixed, via proper retirement (not a silent flip)

The stale BL-1324 Examples row (`--model=qwen3.8-max --effort high | false`)
was **retired with a rationale comment**, not reworded to `true` — per
BL-1006's "retire, never reword" rule (confirmed as an established project
convention, cited correctly, not fabricated: `docs/reference/Specification.MD`
and `docs/reference/BL-1039-shared-git-repo-fixture.md` both cite it). The
retirement note explains the successor coverage (BL-1328's own Outline)
and confirms the other three rows are unaffected. This went through a
specifier amendment commit (`db083992a6`), not a coder-only edit.

Collaterally, the coder also caught and fixed a second, more fundamental
issue in the SAME pass: BL-1324's own property-test invariant 1 had a
byte-exact content pin on the hotfix's `swarmforge.sh` regions that made it
forbid ANY future edit to those regions — including the very follow-up
BL-1324's own human ruling authorized. Retired in favor of an "attribution"
check (does any commit whose subject names BL-1324 touch the hotfix path —
never re-editing it), matching the same content-vs-attribution reasoning
already established in this session's BL-1323 fix. Measured before/after:
11 pass / 0 fail → 0 pass / 11 fail → 10 pass / 0 fail (one row retired).

## Verification (run, not assumed)

- `run_acceptance.sh specs/features/BL-1324*` — 10/10 pass (was 11, one row
  properly retired rather than silently flipped).
- `run_acceptance.sh specs/features/BL-1328-…feature` — 4/4 pass.
- `run_acceptance.sh specs/features/BL-1330*` — 12/12 pass.
- `./swarmforge/scripts/test/test_bl1328_qwen_model_token_forms.sh` (run
  correctly, respecting its zsh shebang) — ALL PASS, 11/11.
- `npx vitest run --config vitest.properties.config.mjs
  bl1324ClaudeSeatQwenCloudContextWindowInvariants
  bl1328QwenModelTokenFormsInvariants` — 6/6 pass.
- `bl1328QwenModelTokenFormsInvariants` re-run 15 consecutive times — 0/15
  failures, no flake.

## Verdict

D1 fixed properly (retirement, not reword), production code unchanged from
what I already reviewed, no new defect found. Forwarding.
