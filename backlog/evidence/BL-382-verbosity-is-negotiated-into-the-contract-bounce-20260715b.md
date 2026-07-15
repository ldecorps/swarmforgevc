# BL-382 QA bounce — 2026-07-15 (2nd bounce)

## Failing command
```
# 1. Onboard a target with verbosity: concise, generate prompts, confirm concise.
mkdir -p /tmp/bl382repro/.swarmforge
cat > /tmp/bl382repro/.swarmforge/contract.yaml <<'YAML'
scope: [everything]
outOfScope: [nothing]
boundaries: [none]
initialBacklogSummary: "test"
agreement: agreed
verbosity: concise
YAML
cat > /tmp/bl382repro/survey-facts.json <<'JSON'
{"languages":["TypeScript"],"layoutSummary":"flat","readmeSummary":"readme",
 "seedVision":"vision","initialBacklogSummary":"backlog","useCaseObservations":[]}
JSON
node extension/out/tools/propose-onboarding-prompts.js /tmp/bl382repro /tmp/bl382repro/survey-facts.json
grep "Be " /tmp/bl382repro/project.prompt   # => "Be concise ..." (correct, this half of the bounce is fixed)

# 2. The human changes his mind: edit the contract's verbosity to detailed
# (standing in for a real negotiation round; no live CLI can do this today,
# see "First error excerpt" below), then regenerate per the ticket's own
# E2E QA procedure: "re-negotiate to detailed and assert the regenerated
# prompts change accordingly."
sed -i 's/verbosity: concise/verbosity: detailed/' /tmp/bl382repro/.swarmforge/contract.yaml
node extension/out/tools/propose-onboarding-prompts.js /tmp/bl382repro /tmp/bl382repro/survey-facts.json
grep "Be " /tmp/bl382repro/project.prompt
```

## Commit hash
`98cb3d4725d46de755adb41b932c1d5c04d61604` (QA's merge of documenter
`6d8607cbf9` / BL-382 coder fix `1981edca`, into `swarmforge-QA`). This
commit correctly fixes the FIRST bounce (`825495131d`: verbosity never
reached generated prompts at all) — confirmed independently, `Be concise`
now shows up correctly on first generation. This is a NEW, second gap.

## First error excerpt
```
$ node extension/out/tools/propose-onboarding-prompts.js /tmp/bl382repro /tmp/bl382repro/survey-facts.json
{
  "created": [],
  "skipped": [
    "project.prompt",
    "engineering.prompt"
  ],
  "committed": false,
  "withheld": false
}
$ grep "Be " /tmp/bl382repro/project.prompt
Be concise in your responses and explanations.
```
(Expected `Be detailed ...` after the contract's verbosity changed to
`detailed` and prompts were regenerated. Still `Be concise` — the stale
value from the first generation.)

## Failure class
`behavior` — not a compile/unit/acceptance failure (unit suite: 270/270
files, 3809/3809 tests green; acceptance run for this feature: 6/6 green,
including "The human can change his mind about verbosity"). The acceptance
scenario passes only because its step handler
(`specs/pipeline/steps/verbosityIsNegotiatedIntoTheContractSteps.js`) calls
`proposePromptsFromSurvey` directly in-memory and never drives the real
`propose-onboarding-prompts.js` CLI — the exact same class of blind spot
the FIRST bounce on this ticket already named ("this gap is invisible to
both the unit suite and the acceptance run and only surfaces by driving
the actual CLI end to end").

Root cause, verified by reading the code, not just observing the symptom:
- `extension/src/config/targetBootstrap.ts`'s `writeAndCommitBootstrapPlan`
  (shared by `initializeTargetPrompts`) only ever writes files that do NOT
  already exist (`plan.filesToCreate`, computed from `existingFiles`) —
  an already-present `project.prompt`/`engineering.prompt` is unconditionally
  reported as `skipped` and its content is never touched.
- `propose-onboarding-prompts.ts`'s own docstring documents this precisely:
  "Re-running this CLI after the operator agrees is what actually commits
  the files" — i.e. re-running is meant to flip `withheld:true` to
  `committed:true` once agreement lands, NOT to refresh content that
  already changed. There is no flag or code path anywhere in this CLI (or
  in `initializeTargetPrompts`) that forces a rewrite of already-materialized
  prompt content.
- Confirms there is genuinely no live path today for BL-382's own stated
  "human changes his mind" behavior once prompts have already been
  generated once — a structural gap, not a one-line miss. (Separately,
  `negotiate-onboarding-contract.ts`'s objection/approval loop — BL-344 —
  only revises `contract.yaml`/`CONTRACT.md`, via a DIFFERENT,
  unconditional-rewrite code path; it never touches `project.prompt`/
  `engineering.prompt` at all, so that route can't reach this either.)

## Expected vs observed
Expected: per the ticket's own E2E QA procedure, negotiating a new
verbosity and regenerating changes the already-materialized prompts to
match. Observed: the prompts silently keep the FIRST verbosity forever —
`propose-onboarding-prompts.js` skips any prompt file that already exists,
with no way to force a refresh, so a changed contract term never reaches
an already-onboarded target's prompts.
