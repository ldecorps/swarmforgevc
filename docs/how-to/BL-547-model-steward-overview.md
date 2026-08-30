# Model Steward: Onboarding, Certification, and Role Recommendations

Last Updated: 2026-08-30

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

**BL-1140 ranking authority:** entries are ordered by authority tier first
(battery/scorecard/bake-off citations beat other evidence; revoked
`human-operator-priority:ollama-local-qwen-20260825` is worst), then by
score. See [Steward-driven local model bake-off](BL-1140-steward-local-model-bakeoff.md).

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

## Day-long BoB trial lifecycle (BL-1182)

A trial seats a candidate model against a role for one operating day, then
assesses it: promote if it outranks the permanent model (a score tie selects
the cheaper `cost_class`), otherwise revert. Every nomination passes a
go-live checklist first (BL-1183, below) — this lifecycle is the trial
state machine itself.

```bash
bb swarmforge/scripts/model_steward_cli.bb trial nominate <provider>/<model> \
  --role <role> [--evidence <path>]
bb swarmforge/scripts/model_steward_cli.bb trial status [--role <role>]
bb swarmforge/scripts/model_steward_cli.bb trial assess --role <role> [--now <iso>]
```

- **`nominate`** arms a trial: the candidate must already be `certified`
  (`eligible`'s own gate — a trial seat is a live seat) and must not already
  be the role's permanent model. A model that lost a prior trial is refused a
  re-nomination unless `--evidence` names something new — without that, a
  losing model could be re-seated every day forever, each nomination looking
  reasonable in isolation.
- **`status`** reports whether a role has an armed trial, which model, the
  permanent model it is running against, and whether the trial's day window
  is `DUE` for assessment.
- **`assess`** ends the trial: outrank promotes, a tie promotes only when the
  trial is the cheaper `cost_class` (reusing `model_factory_lib`'s own
  cost-class ranking, not a second copy of it), and a loss reverts to the
  permanent model and records steward evidence against silent re-trial.

**The permanent model is what the trial displaces, not "the top-ranked
certified model."** Those sound equivalent and are not: if "permanent" were
defined as the top score, no candidate could ever outrank it, since the
highest score is the permanent by definition — every nomination that could
teach the steward anything would be refused. The resolution order is: what
trial state already recorded for that role → the role's live seat in
ModelFactory's assignment overlay → and only for a role never yet seated, the
top certified role-matrix recommendation as a bootstrap.

**Agent memory transfers at both trial boundaries** (BL-1178) — seating a
candidate and reverting or promoting at the end — through the same
bb → compiled-`extension/out` bridge `handoffd` uses elsewhere
(`trial-boundary-memory.ts`). The transfer runs BEFORE the trial state is
persisted or the seat moves, so a failed transfer leaves no armed trial to
assess later and no half-moved seat — refused, not silently reported as a
success. A promotion owes no boundary transfer at all: the seat already runs
the trial model, so nothing switches.

## The go-live gate: no production trial without something that can judge it (BL-1183)

The human's instruction was direct: do not run live day-long production
trials until telemetry and performance-assessing tools can actually decide
outrank/tie/lose. `run-trial-nominate` runs a checklist BEFORE arming or
seating anything, and a trial that cannot be adjudicated refuses to start
rather than seating a model for a day and learning nothing from it.

```bash
bb swarmforge/scripts/model_steward_cli.bb trial go-live --role <role> <provider>/<model>
```

`trial go-live` reads the checklist without seating anything — safe to run
any time to check readiness in advance; `nominate` runs the identical check
itself before arming.

The checklist is **derived** from what the trial lifecycle's own `decide`
function actually needs to compare a pairing, not a separate list that
could drift from it:

- **Telemetry**: a role-matrix score for BOTH the candidate and the
  permanent model. Without both, `decide` falls through its unscored clause
  and reverts on absent evidence — the trial would seat a non-permanent
  model for a day and never actually compare anything.
- **An assessor**: battery/scorecard/bake-off evidence behind each score
  (`model_steward_lib/battery-or-scorecard-evidence?`, the same predicate
  `ranking-authority-tier` already uses to decide which evidence may
  outrank which). A score with no such citation is somebody's opinion, and
  an opinion cannot adjudicate a day of production.

The gate is **fail-closed** and **names every gap** — an unreadable
registry, an absent role-matrix entry, or an unscored candidate all produce
a refusal naming which model and which half (telemetry or assessor) is
missing, never a silent "not ready":

```
trial refused: the BoB go-live checklist is not satisfied -
  trial-comparison telemetry: no recorded score for the candidate cerebras/trial-model;
  performance assessor: no battery/scorecard/bake-off evidence for the permanent anthropic/perm-model
```

A refusal reporting only "not ready" with no reasons would cost the operator
the same search as having no gate at all, so `go-live-refusal` always
carries every named gap in one string.

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
[ModelFactory assign and apply](./BL-525-model-factory-assign-and-apply.md),
[Wire agent memory into hot-swap and trial](./BL-1178-wire-agent-memory-into-hot-swap-and-trial.md).

Acceptance (Slice 2): `specs/features/BL-556-model-steward-slice2-evaluate-ingestion.feature`.
Acceptance (Slice 3): `specs/features/BL-557-model-steward-slice3-role-and-compat-docs.feature`.
Acceptance (day-long trial lifecycle): `specs/features/BL-1182-day-long-bob-trial-lifecycle.feature`.
Acceptance (go-live gate): `specs/features/BL-1183-bob-go-live-telemetry-assessor-gate.feature`.

