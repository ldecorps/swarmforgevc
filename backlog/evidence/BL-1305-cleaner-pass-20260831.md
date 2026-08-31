# BL-1305 cleaner pass — 2026-08-31

## Inbound

Merged coder commit `56ef140e82` (BL-1305: drop dead adversary-startup-file
code from the step handler — a self-audit follow-up to `63255e3143`) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry confirmed:
`git merge-base --is-ancestor 56ef140e82 HEAD` after merge. Merge commit
`62f9f5c420`.

## Checks run

1. **Unit** — `npx vitest run test/bl1305FixtureAgentBinary.test.js`:
   3/3 pass (`extension/`).
2. **Property** —
   `npx vitest run --config vitest.properties.config.mjs bl1305FixtureAgentBinary.property.test.js`:
   2/2 pass, including the reach-floor test proving the generator hits the
   states where PATH precedence alone would lose.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1305-fixture-agent-binary-is-the-stub.feature`:
   3/3 pass. Required wiring confirmed: `bl1305FixtureAgentBinarySteps`
   registered in `specs/pipeline/steps/index.js:169`.
4. **Shell (new suite from this batch's merge)** —
   `test_swarm_handoff_inbound_non_forwarding.sh`: ALL PASS (unrelated
   BL-1302 content riding the same merge-up chain, not this ticket's own
   work — no action needed here).
5. **jscpd** over the four touched/added files
   (`bl1305FixtureAgentBinarySteps.js`, `roleLifecycleParkUnneededSteps.js`,
   `bl1305FixtureAgentBinary.test.js`, `bl1305FixtureAgentBinary.property.test.js`):
   0 clones.

## Mutation-site count (BL-485)

`node extension/out/tools/mutation-site-count.js specs/pipeline/steps/bl1305FixtureAgentBinarySteps.js specs/pipeline/steps/roleLifecycleParkUnneededSteps.js`
reports both `over` the 100-site advisory threshold (169 and 552
respectively). Weighed against a split: both files are single-feature
`registry.define()` collections, the established shape for every file under
`specs/pipeline/steps/`. `roleLifecycleParkUnneededSteps.js`'s size predates
this ticket by far — this ticket added ~70 lines to an existing ~440-line
file — and a split now would be a large undertaking unrelated to this
ticket's scope, not a structural improvement this diff calls for. Leaving
both whole; a mechanical line-count chop would not improve separation of
concerns here. Soft advisory, not acted on.

## Cleanup performed

NONE needed. The coder's own self-audit commit (`56ef140e82`) already
removed the one piece of dead/misleading code (an unreachable planted
startup file in scenario 02's Given, plus an unused `launchOutput`
assignment) before this parcel reached cleaner. Reviewed the resulting
`bl1305FixtureAgentBinarySteps.js` and the production fix in
`roleLifecycleParkUnneededSteps.js` (ZDOTDIR isolation, resident stub,
`liveFakeBinDirs` reaper tracking) for structure, encapsulation, and DRY;
found nothing to change.

## Findings beyond that

NONE for BL-1305. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1305-fixture-agent-binary-is-the-stub`.

By cleaner.
