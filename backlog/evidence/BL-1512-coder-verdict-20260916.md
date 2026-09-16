# BL-1512 — coder eligibility verdict, 2026-09-16

Per the ticket's own FIRM instruction ("If gpt-5.3-codex or qwen3.7-plus
fails the gate or eligibility on the real registry, STOP and note the
specifier with the verdict - the pick is the operator's to change, not
the coder's") and Scenario-notes step 2 (`model_steward_cli.bb eligible
<provider>/<model> --role <role>`, no `--override-uncertified`), ran the
real eligibility check for all 8 seats before writing the pack file.

## Verdicts

| seat | pick | verdict |
|---|---|---|
| coder | openai/gpt-5.3-codex | **eligible** |
| architect | openai/gpt-5.3-codex | **eligible** |
| specifier | cursor/auto | **ineligible** |
| cleaner | cursor/auto | **ineligible** |
| hardender | cursor/auto | **ineligible** |
| QA | cursor/auto | **ineligible** |
| documenter | openai/qwen3.7-plus | **ineligible** |
| coordinator | anthropic/claude-sonnet-5 (human_ruling) | **eligible** |

`bb swarmforge/scripts/model_steward_cli.bb status` in this worktree
lists exactly three known models: `anthropic/claude-sonnet-5`
(certified), `openai/gpt-5.3-codex` (certified),
`cerebras/llama-3.3-70b` (candidate). `cursor/auto` and
`openai/qwen3.7-plus` are not merely uncertified - they do not appear in
this worktree's model-steward registry at all, so `eligible` refuses
them outright (not an override-hatch case).

**5 of 7 non-coordinator seats fail.** Per the ticket's constraint, I did
not substitute alternate picks, did not write the pack file (a pack
missing valid lines for 5 of 7 pipeline seats is not a deployable
artifact), and did not run the staffing-gate/launch scenarios that
depend on those picks.

## Same root cause as BL-1511 (backlog/evidence/BL-1511-coder-spec-gap-20260916.md)

That ticket's independent finding: this worktree's
`.swarmforge/model-steward/registry.json` also lacks role-matrix entries
for `tencentcloud2/glm-5.3-flash` and `anthropic/claude-fable-5-1`,
models the SAME 2026-09-09 operator intake cites with specific scores.
Two tickets split from the same intake, on the same day, both hitting
"this worktree's model-steward state doesn't carry the evidence the
intake cites" - worth the specifier's attention as a possible pattern
(stale/incomplete per-worktree runtime state) rather than two unrelated
gaps, though I cannot tell from here whether the evidence lives in a
different worktree/session or has simply not been run yet.

## Ask

Per the ticket: is the operator's evidence for cursor/auto and
qwen3.7-plus available to certify/register in this checkout (and, if so,
where), or should these picks be reconsidered? Not proceeding with the
pack file until this is adjudicated.
