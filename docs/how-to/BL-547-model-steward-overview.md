# Model Steward: Onboarding, Certification, and Role Recommendations

Last Updated: 2026-08-24

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

### 2. Prefer capture-then-evaluate (BL-556)

Once recruiter / bake-off evidence exists as a file, **ingest** it with
`evaluate` (Slice 2). That path updates capabilities, writes an
evidence-backed certification report with real gates, and records a
role-matrix ranking whose evidence pointer is the scorecard id (and bake-off
id when given). See [Capture then evaluate](#capture-then-evaluate-bl-556)
below. `evaluate` does **not** spawn the battery or recruiter — capture is a
separate step.

### 3. Or certify from a planted scorecard (BL-1079)

When you only have the well-known compliance-battery scorecard path (no
recruiter capture wrapper), plant it and certify:

```bash
STATE="${MODEL_STEWARD_STATE_DIR:-.swarmforge/model-steward}"
# scorecards/<provider>__<model>.json — required evidence (BL-1079)
bb swarmforge/scripts/model_steward_cli.bb certify <provider>/<model>
```

Example:
```bash
bb swarmforge/scripts/model_steward_cli.bb certify anthropic/claude-opus-4-8
```

Absent that scorecard, `certify` refuses, names the path it wanted, leaves the
status unchanged, and writes no certification report. When evidence is
present, the CLI outputs the certification report path and the scorecard path
it read. For the Cursor identity specifically, see
[Certifying a Cursor identity](./BL-1079-cursor-identity-steward-certify-and-residuals.md).

## Capture then evaluate (BL-556)

`evaluate` is pure ingest: it reads captured JSON and updates the registry.
Recruiter / bake-off tools print to stdout today — pipe them to a file first
(operator capture, or a named future wiring step). Do not expect `evaluate`
to run the battery.

### Capture wrapper contract

Paths may be absolute or relative to the steward state dir (typically under
`evidence/`). Each capture file must carry a stable id — missing ids are
refused; ids are never invented:

| Artifact | Required top-level field | Body |
|---|---|---|
| Recruiter scorecard | `scorecard_id` | BatteryScorecard fields (`model`, `entries`, `overall`) at the top level **or** under `scorecard` |
| Bake-off run (optional) | `bakeoff_run_id` | LabeledRecruiterReport fields at the top level **or** under `report` |

### Run evaluate

```bash
STATE="${MODEL_STEWARD_STATE_DIR:-.swarmforge/model-steward}"
mkdir -p "$STATE/evidence"

# Capture (illustrative — redirect recruiter-run / bakeoff-run stdout yourself)
# node extension/out/tools/recruiter-run.js … > "$STATE/evidence/my-scorecard.json"
# Ensure the file includes "scorecard_id": "recruiter-scorecard:…"

bb swarmforge/scripts/model_steward_cli.bb evaluate <provider>/<model> \
  --role <role> \
  --scorecard <path-to-scorecard.json> \
  [--bakeoff <path-to-bakeoff.json>] \
  [--decertify-on-regression]
```

Example:

```bash
bb swarmforge/scripts/model_steward_cli.bb evaluate anthropic/claude-sonnet-5 \
  --role coder \
  --scorecard .swarmforge/model-steward/evidence/coder-scorecard.json
```

What happens on success:

1. Capability registry dimensions are updated from the scorecard (and bake-off
   when given).
2. A role-matrix ranking for `--role` records the evidence pointer
   (`scorecard_id`, or `scorecard_id+bakeoff_run_id` when bake-off is present).
3. A certification report under `certification-reports/` carries non-empty
   gates from the ingested entries, the scorecard id, and (when re-evaluating)
   a pass→fail regression diff vs the prior report.
4. Clean gates certify the model; with `--decertify-on-regression`, a
   pass→fail regression also drives `decertify` with a regression reason.
   Manual `decertify` remains available without that flag.

Register the model first — `evaluate` refuses an unknown `provider/model`.

Confirm:

```bash
bb swarmforge/scripts/model_steward_cli.bb show <provider>/<model>
bb swarmforge/scripts/model_steward_cli.bb capability <provider>/<model>
bb swarmforge/scripts/model_steward_cli.bb role-matrix <role>
```

## Certification Workflow

### Certifying a model

- **`evaluate … --scorecard …`** (BL-556) — preferred when you have a captured
  recruiter / bake-off artifact; produces evidence-backed gates and role-matrix
  evidence pointers.
- **`certify <provider>/<model>`** — Records a model as production-ready **only
  when** a compliance-battery scorecard exists at
  `scorecards/<provider>__<model>.json` under the steward state dir (BL-1079).
  Creates a certification report with an ISO timestamp that names that
  scorecard; the model's status changes to `certified` and the report path is
  stored in its registry entry.

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

Scripted path: `evaluate … --decertify-on-regression` when a re-ingest shows a
gate that previously passed now failing.

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
- **Captured evidence (BL-556):** `.swarmforge/model-steward/evidence/` (operator-written JSON for `evaluate`)
- **Certification reports:** `.swarmforge/model-steward/certification-reports/` (and legacy `reports/` paths where older tickets still name them)
- **BL-1079 certify scorecards:** `.swarmforge/model-steward/scorecards/<provider>__<model>.json`

All CLI commands read from and write to the runtime state, so changes persist across future invocations.

## Slice 3 (BL-557): steward as a role + compatibility docs

The Model Steward graduates from a Slice 1 stub prompt into a
**coordinator-assignable infrastructure role**. The coordinator MAY assign it
discrete tasks such as onboard a new model, re-certify after a bake-off, or
investigate a capability regression. The steward's output is certification and
registry knowledge only — it never mutates ModelFactory routing.

### What the steward is not

- No always-on pane, mailbox, worktree, or standing event loop
- Not a permanent resident of the swarm roster
- Not a routing authority (routing stays with ModelFactory / packs)

### Compatibility docs (generated)

```bash
# From repo root (after registry updates / known_limitations changes)
bb swarmforge/scripts/model_steward_cli.bb compat-docs
# → writes docs/reference/model-compatibility.md
```

That file is the human-facing projection of registry statuses,
`known_limitations`, and the certified role-recommendation matrix. **Do not
hand-edit it** — regenerate via `compat-docs`. The docs index links it under
Reference.

## Related

Related: [Route work to a local-model seat](./BL-1053-route-work-to-a-local-model-seat.md),
[Wire Mistral Vibe into the Intelligence Layer](./BL-682-mistral-vibe-intelligence-layer-routing.md),
[ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md).

Acceptance (Slice 2): `specs/features/BL-556-model-steward-slice2-evaluate-ingestion.feature`.
Acceptance (Slice 3): `specs/features/BL-557-model-steward-slice3-role-and-compat-docs.feature`.

