# Model Steward: Onboarding, Certification, and Role Recommendations

Last Updated: 2026-07-22

SwarmForge's **Model Steward** maintains the Model Registry, Capability Registry, Role Recommendation Matrix, and Prompt Adapter catalogue — the permanent home for knowledge about each language model the swarm uses.

## Onboarding a New Model

When you want to add a new language model to SwarmForge:

### 1. Register the model

```bash
bb swarmforge/scripts/model_steward_cli.bb register <provider>/<model> \
  [--status candidate|certified|deprecated] \
  [--context-window N] \
  [--cost-class low|medium|high]
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb register anthropic/claude-opus-4-8 \
  --status candidate \
  --context-window 200000 \
  --cost-class high
```

**Note:** A model always enters as `candidate` by default. It is never certified automatically.

### 2. Certify the model

Once you have benchmarked the model and confirmed it meets SwarmForge quality standards:

```bash
bb swarmforge/scripts/model_steward_cli.bb certify <provider>/<model>
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb certify anthropic/claude-opus-4-8
```

The CLI outputs the path to the certification report artifact, which it creates automatically.

## Certification Workflow

### Certifying a model

- **`certify <provider>/<model>`** — Records a model as production-ready. Creates a certification report with an ISO timestamp; the model's status changes to `certified` and the report path is stored in its registry entry.

### Decertifying a model

If a model regresses or no longer meets quality standards:

```bash
bb swarmforge/scripts/model_steward_cli.bb decertify <provider>/<model> \
  --reason "<explanation of regression>" \
  [--status candidate|deprecated]
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb decertify anthropic/claude-opus-4-7 \
  --reason "Regression in tool-use accuracy observed in battery run on 2026-07-20" \
  --status deprecated
```

**Required.** The `--reason` flag must always be present and non-empty. The new status defaults to `candidate` if omitted.

## Reading the Role Recommendation Matrix

To see which models are ranked for a specific swarm role:

```bash
bb swarmforge/scripts/model_steward_cli.bb role-matrix <role> [--include-uncertified]
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb role-matrix coder
```

Output:
```
anthropic/claude-opus-4-8 95 bakeoff-run-id:2026-07-20
anthropic/claude-sonnet-5 88 recruiter-scorecard-id:2026-07-18
```

The output is a ranked list of `provider/model score evidence-pointer` tuples, where:
- `score` is a numerical ranking (higher = better fit for this role)
- `evidence` points to the source (bakeoff run or recruiter scorecard)

**By default, only certified models appear.** To include uncertified candidates:

```bash
bb swarmforge/scripts/model_steward_cli.bb role-matrix coder --include-uncertified
```

## Viewing Model Details

### Registry entry for a model

```bash
bb swarmforge/scripts/model_steward_cli.bb show <provider>/<model>
```

Returns the full registry entry as JSON, including provider, model ID, context window, cost class, certification status, and report paths.

### Capability scores for a model

```bash
bb swarmforge/scripts/model_steward_cli.bb capability <provider>/<model>
```

Returns the capability registry entry (coding quality, protocol compliance, tool usage, autonomy, cost, latency scores).

### Adapter metadata

```bash
bb swarmforge/scripts/model_steward_cli.bb adapter <provider>/<model>
```

Returns which PromptEngine adapter ID a model uses and whether it is marked as a production default.

## Registry Status

View the entire model registry at a glance:

```bash
bb swarmforge/scripts/model_steward_cli.bb status
```

Output:
```
anthropic/claude-opus-4-8 certified
anthropic/claude-sonnet-5 certified
anthropic/claude-haiku-4.5 candidate
```

## Production Eligibility

To check whether a model is eligible for production assignment (e.g., when ModelFactory is deciding which model to use):

```bash
bb swarmforge/scripts/model_steward_cli.bb eligible <provider>/<model> --role <role> [--override-uncertified]
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb eligible anthropic/claude-opus-4-8 --role architect
```

In production mode:
- Only certified models are eligible.
- Non-certified models are rejected unless `--override-uncertified` is explicitly passed (an operator escape hatch).

## Data Locations

- **Committed registry schema:** `swarmforge/model-steward/schema/registry.schema.json`
- **Seed models:** `swarmforge/model-steward/seed/models.seed.json`
- **Runtime state:** `.swarmforge/model-steward/` (gitignored; initialized on first read from seed on your local repository)
- **Certification reports:** `.swarmforge/model-steward/reports/{timestamp}-{provider}-{model}.json`

All CLI commands read from and write to the runtime state, so changes persist across future invocations.

