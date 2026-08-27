# BL-256 bounce evidence — 20260710 (QA)

## Failing command

No test fails — 197/197 unit test files (2676 tests), 5/5 acceptance, both
Babashka suites, and CRAP (92, baseline, no new debt) are all green. The
gap is that the acceptance CONTRACT's own wording doesn't match what it
verifies or what was built.

## Commit hash tested

`cc45da2bbe` (QA's merge of documenter's handoff `f2506de1be`).

## First error excerpt

```
$ node out/tools/chase-trend-line.js
Chase/nudge trend: no chase or nudge activity in the trailing 7d.
```

The real, compiled CLI's own output is honestly labeled "Chase/nudge
trend" — no mention of a QA-bounce rate anywhere, because none is
computed (coder's own commit message: "No distinct QA-bounce counter
exists anywhere in this codebase (grep-confirmed)"). `docs/Specification.MD`
matches this honestly ("a QA-bounce/chase trend line ... reporting
chase/nudge/dead-letter counts"). But
`specs/features/BL-256-briefing-enrichment.feature`'s own Scenario/Given/
Then text still literally says:

```gherkin
# BL-256 qa-bounce-chase-trends-03
Scenario: the briefing reports QA-bounce and chase trends
  Given QA-bounce and chase/nudge telemetry over the recent window
  When the briefing is generated
  Then it reports the QA-bounce rate and chase/nudge counts with their trend direction
```

and `specs/pipeline/steps/briefingEnrichmentSteps.js`'s step handler for
that exact Then line never checks for anything QA-bounce-related — it
only asserts `chase(s)`/`nudge(s)` substrings and a trend direction:

```js
registry.define(/^it reports the QA-bounce rate and chase\/nudge counts with their trend direction$/, (ctx) => {
  const text = formatChaseTrendLine(ctx.chaseCurrent, ctx.chaseTrend, ['coder']);
  if (!/chase\(s\)/.test(text) || !/nudge\(s\)/.test(text)) { ... }
  if (!['up', 'down', 'flat', 'unknown'].includes(ctx.chaseTrend.direction)) { ... }
});
```

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure — every test genuinely
passes, including this one, because the step handler was (correctly)
never written to check for something that doesn't exist. The defect is
in the ACCEPTANCE CONTRACT'S OWN TEXT: the Scenario name, the Given
clause, and the Then clause all claim "QA-bounce rate" coverage that
is neither computed, tested, nor delivered.

## Expected vs observed

Expected: per this project's own stated principle (feature files are
"the durable, machine-executable contract... the actual pass/fail bar
the swarm is held to" — `docs/Onboarding-New-Project.md`), a Scenario's
prose should accurately describe what it verifies. Coder's decision to
scope this section to chase/nudge/dead-letter only (no QA-bounce
counter exists) is a reasonable, well-disclosed engineering judgment
call — I am not bouncing that decision.
Observed: the feature file's own Scenario name
("qa-bounce-chase-trends-03"), Given clause ("QA-bounce and chase/nudge
telemetry"), and Then clause ("it reports the QA-bounce rate and
chase/nudge counts") were never updated to reflect the scoped-down
reality, even though `docs/Specification.MD` (a different, non-binding
document) WAS updated honestly in the same commit chain. A future reader
of the feature file alone — the artifact this project treats as the
durable source of truth, outliving the ticket — would reasonably believe
QA-bounce-rate reporting is built and verified when it is not.

## Suggested fix scope (documenter/specifier call, not prescribed here)

Reword the Scenario name/Given/Then text to say what is actually true and
tested — e.g. "the briefing reports chase/nudge trends" / "Given
chase/nudge telemetry over the recent window" / "Then it reports the
chase/nudge counts with their trend direction" — matching
`docs/Specification.MD`'s own already-honest wording and the real CLI's
own "Chase/nudge trend:" output label. No code change is needed; only the
`.feature` file's prose (and, for consistency, the mutation-stamp comment
block's own `feature_name`/scenario name strings at the top of the file,
if the tooling re-derives those from a hash of the corrected text).
