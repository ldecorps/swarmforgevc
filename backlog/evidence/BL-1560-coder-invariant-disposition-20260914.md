# BL-1560 coder invariant disposition

## Declared invariant

> The stamp never rewrites the hotfix: every file the parcel touches is
> evidence, a feature, a step handler (plus its lib/ helpers), or a file
> under swarmforge/scripts/test/; swarmforge/scripts/swarmforge.sh,
> tool_miss_heal_lib.bb and tool_miss_heal_hook.bb are byte-identical to
> the received commit.

## Disposition: no executable property test authored (stated reason)

This invariant is a fixed structural check over the parcel's OWN diff
scope - "which paths did this commit touch, and are three named files
byte-identical to what `main` already carries" - not a property that
quantifies over a generated input space. There is no meaningful
generator here: the invariant names three specific files and a fixed set
of allowed path shapes (evidence/, the feature file, the step handler and
its `lib/` helpers, and `swarmforge/scripts/test/`); varying an input
would mean fabricating different hypothetical diffs to check against the
same fixed rule, which tests the checking logic, not this parcel's actual
behavior.

## What proves the invariant instead

Two direct, deterministic checks, run against the real parcel commit:

```
git diff main...HEAD --name-only
```

names only `backlog/evidence/BL-1560-*.md`,
`specs/features/BL-1560-swarm-stamp-missing-script-path-1fc9065605.feature`,
`specs/pipeline/steps/bl1560SwarmStampMissingScriptPathSteps.js`, and
`specs/pipeline/steps/lib/bl1560ToolMissHealCli.bb` - verified directly
during this review (recorded above in the main evidence file).

```
git diff main...HEAD -- swarmforge/scripts/swarmforge.sh \
  swarmforge/scripts/tool_miss_heal_lib.bb \
  swarmforge/scripts/tool_miss_heal_hook.bb
```

is empty - the three named files are untouched. This is also the ticket's
own `qa_e2e_procedure` step 1, so QA independently re-verifies it at the
gate; this parcel does not rely solely on its own self-check.
