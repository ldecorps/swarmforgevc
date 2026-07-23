# BL-382 QA bounce — 2026-07-15

## Failing command
```
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
grep "Be " /tmp/bl382repro/project.prompt /tmp/bl382repro/engineering.prompt
```

## Commit hash
`55b9c3ba32ab78b6157d876c512c34eae7a58401` (QA's merge of documenter
`d17245b685` / BL-382 coder commit `7c03dbdc`, into `swarmforge-QA`).

## First error excerpt
```
/tmp/bl382repro/engineering.prompt:11:Be normal in your responses and explanations.
/tmp/bl382repro/project.prompt:11:Be normal in your responses and explanations.
```
(Expected `Be concise`, per the contract's own `verbosity: concise`.)

## Failure class
`behavior` — not a compile/unit/acceptance failure (unit suite: 3769/3769
green; acceptance run for this feature: 6/6 green). The pure functions
(`resolveVerbosity`, `proposePromptsFromSurvey` in
`extension/src/onboarding/promptProposal.ts`) are correct and well tested in
isolation, but the ticket's own Scenario 01 acceptance criterion — "The
agreed verbosity reaches the generated prompts" — is never actually true in
the live pipeline. The gap is a missing wire, not a missing test:

- `extension/src/tools/propose-onboarding-prompts.ts:33` calls
  `proposePromptsFromSurvey(facts)` with NO second argument, even though the
  same function already reads the target's contract at line 34
  (`readContractYaml(targetRepoPath)`) for the gate decision. The contract's
  verbosity is simply never extracted or passed through.
- Even if it were: `extension/src/onboarding/contractView.ts`'s
  `parseContractYaml` — the only function that turns raw contract.yaml text
  back into a `ProposedContract` — builds its return object from only
  `{scope, outOfScope, boundaries, initialBacklogSummary, agreement}`
  (lines 47-53), silently dropping `candidate.verbosity` even when present
  in the parsed YAML.
- And upstream of that: `verbosity` does not appear anywhere in
  `contractNegotiation.ts` or `negotiate-onboarding-contract.ts` — there is
  no path today for a human to actually negotiate a verbosity term into a
  real `contract.yaml` in the first place.

grep confirms `verbosity` exists nowhere in `extension/src` outside
`contractTypes.ts` and `promptProposal.ts` themselves.

The feature file's own step handler
(`specs/pipeline/steps/verbosityIsNegotiatedIntoTheContractSteps.js`) calls
`proposePromptsFromSurvey` directly with an in-memory `ctx.verbosity`,
bypassing the real CLI/contract-parse path entirely — which is why this gap
is invisible to both the unit suite and the acceptance run and only surfaces
by driving the actual `propose-onboarding-prompts.js` CLI end to end.

## Expected vs observed
Expected: a target repo with an agreed contract carrying `verbosity: concise`
generates `project.prompt`/`engineering.prompt` that say "Be concise ...".
Observed: they say "Be normal ..." — the DEFAULT_VERBOSITY fallback — because
the negotiated value never reaches `proposePromptsFromSurvey` through any
real caller.
