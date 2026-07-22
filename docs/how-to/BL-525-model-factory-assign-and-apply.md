# ModelFactory: Assigning and Applying Agent Models

Last Updated: 2026-07-22

SwarmForge's **ModelFactory** assigns language models to swarm roles based on steering policies and provider availability. It consumes the Model Steward registry and applies your choice of budget rules: run cheap, run quality, or override with explicit models.

## Quick Start: Assign Models to a Swarm Role Set

### Quality-first assignment

```bash
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality
```

Returns a full role→{agent, provider, model, reason, policy} map where each role gets the highest-capability certified model available.

### Budget-first assignment

```bash
bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
```

Returns a role map biased toward free/daily-capped plans first, then lowest $/quality tier within role-specific cost floors. Ignores exhausted providers on today's calendar.

### Assignment with uncertified override

Some deployments may need to test uncertified candidates. Override the certification gate:

```bash
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality --override-uncertified
```

The returned map includes an `override_uncertified: true` flag per role; each entry's `reason` records that it fell outside quality gates.

## Daily-Cap Failover and Exhaustion Detection

ModelFactory tracks daily-capped providers (Cerebras, GPT free tier, etc.) in a runtime quota state file.

### Detecting exhaustion

When a provider's quota resets on the calendar day boundary, the swarm re-evaluates it as available:

```bash
bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
```

The assignment predicates include:
- **Today's date boundary** – Reset time is 00:00 local timezone.
- **Per-provider last-exhausted record** – Stored in `.swarmforge/model-factory/quota-state.json`.
- **Backward-compatible fallback** – If a provider is flagged exhausted, the next policy-matching model is tried before escalating to the next steward tier.

### Example: Cerebras exhausted today

If Cerebras free-daily was used up, cheap-mode assignment skips it:

```bash
# Cerebras free-daily exhausted
bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
# Expected: coder={agent: anthropic, provider: openai, model: gpt-4-turbo}
#           (or next in cheap tier, NOT cerebras)
```

Once the date rolls over:

```bash
# Calendar day changed (e.g., 2026-07-23 00:00)
bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
# Expected: coder={agent: cerebras, provider: cerebras, model: sonnet} (if available)
```

### Injecting quota exhaustion (testing)

For acceptance tests and validation, inject an exhaustion marker:

```bash
# Pretend Cerebras is exhausted today
QUOTA_STATE_OVERRIDE='{"cerebras": "2026-07-22"}' \
  bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
```

The quota-state file can also be manually edited:

```json
{
  "cerebras": "2026-07-22",
  "openai": null
}
```

Dates are ISO calendar day strings (`YYYY-MM-DD`). `null` means never exhausted (always available).

## Cold-Apply: Stop, Relaunch, and Observe

**Slice 1** (shipped) supports cold-apply: generate an assignment, then stop the swarm and relaunch under the new model configuration.

### Manual cold-apply flow

1. **Generate assignment** on your local repo:
   ```bash
   cd /path/to/swarmforge/repo
   bb swarmforge/scripts/model_factory_cli.bb assign --mode quality
   ```
   Output: pretty-printed role map + generation timestamp. The assignment is written to `.swarmforge/model-factory/assignment.json`.

2. **Kill the running swarm:**
   ```bash
   ./swarmforge/scripts/kill_all_swarm.sh
   ```

3. **Relaunch** with the new assignment. ModelFactory writes a generated launch config; the standard restart reads it:
   ```bash
   ./swarm <target-repo-path>
   ```
   Alternatively, explicitly pass the pack:
   ```bash
   ./swarm <target-repo-path> --pack quality-default
   ```

4. **Verify role assignments** by inspecting live panes:
   ```bash
   tmux capture-pane -t <session> -p -S -100
   ```
   Spot-check `coder` and `coordinator` panes to confirm the agent/model shown matches the assignment map.

### Failover example: Cerebras → OpenAI

Suppose your swarm ran on `cerebras-mono-router` and Cerebras free-daily is exhausted:

```bash
# Current: cerebras-mono-router, coder=cerebras/sonnet
# Run cheap-mode assignment
bb swarmforge/scripts/model_factory_cli.bb assign --mode cheap
# → assignment.json now lists coder=openai/gpt-4-turbo (or equivalent)

# Kill and relaunch
./swarmforge/scripts/kill_all_swarm.sh
./swarm <target-repo-path>

# After 10s (pane boot):
tmux capture-pane -t swarm:0 -p -S -50 | grep -i coder
# Should show OpenAI agent/keys in use
```

## Hot-Apply (Slice 2): Respawn Without Full Stop

**Slice 2** (future) will support hot-apply: respawn only the roles whose assignment changed, preserving in-process work and mailboxes. This feature is not yet shipped. See `specs/features/BL-525-model-factory-slice-2.feature.draft` for acceptance criteria.

When hot-apply ships, the flow will be:

```bash
# Generate assignment for quality
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality

# Hot-apply delta (respawn affected roles only, preserve parcels)
# (command TBD in Slice 2)

# Affected roles restart on new agent/model; others uninterrupted
# In-process parcels preserved
# No full swarm stop/restart
```

## Assignment Artifact Format

Generated assignments are written to `.swarmforge/model-factory/assignment.json` (gitignored):

```json
{
  "coder": {
    "agent": "anthropic",
    "provider": "cerebras",
    "model": "sonnet",
    "reason": "cheapest certified tier",
    "policy": "cheap",
    "override_uncertified": false
  },
  "cleaner": {
    "agent": "anthropic",
    "provider": "openrouter",
    "model": "claude-haiku-4.5",
    "reason": "cost-class low + certified",
    "policy": "cheap",
    "override_uncertified": false
  },
  ...
}
```

Each role entry includes:
- `agent` – The agent implementing the role (e.g., "anthropic", "cerebras").
- `provider` – The API provider for the model.
- `model` – The model ID as registered in Model Steward.
- `reason` – Human-readable explanation of the choice (e.g., "next in cheap tier", "certified top score").
- `policy` – The steering mode (`cheap`, `quality`, `override`).
- `override_uncertified` – Boolean; true if the model fell outside certification gates.

## Secret Handling

API keys and credentials are **never** stored in the assignment.json file or generated launch configs. ModelFactory emits only the descriptor: the provider and model name.

Keys are injected into role panes via:
- Environment variables in the launch `-e` flag.
- Host secret store (operator-provided at launch).
- Specific provider integration (e.g., `OPENAI_API_KEY`, `CEREBRAS_API_KEY`).

See [Secrets & Multi-Provider Setup](../reference/Specification.md#secrets-and-multi-provider-support) for the full secret injection pattern.

## Steward Integration: Checking Eligibility

Before or after assignment, verify that the model is properly certified:

```bash
# Check if anthropic/claude-opus-4-8 is eligible for the architect role
bb swarmforge/scripts/model_steward_cli.bb eligible anthropic/claude-opus-4-8 --role architect

# Override the certification gate (for testing)
bb swarmforge/scripts/model_steward_cli.bb eligible anthropic/claude-opus-4-8 --role architect --override-uncertified
```

Return codes:
- `0` – Eligible (certified or override granted).
- `1` – Not eligible (not certified, no override).

## Data Locations

- **Decision library (pure functions):** `swarmforge/scripts/model_factory_lib.bb`
- **CLI wrapper:** `swarmforge/scripts/model_factory_cli.bb`
- **Assignment artifact schema:** `swarmforge/model-factory/schema/assignment.schema.json`
- **Quota state seed:** `swarmforge/model-factory/seed/quota-state.seed.json`
- **Runtime state (gitignored):**
  - `.swarmforge/model-factory/assignment.json` — The current/last generated assignment.
  - `.swarmforge/model-factory/quota-state.json` — Per-provider exhaustion tracking.
- **Test runner:** `swarmforge/scripts/test/model_factory_test_runner.bb`
- **Live-pane cold-apply helper (future):** `swarmforge/scripts/model_factory_default_launch_seam.sh`

## Troubleshooting

### No certified models for a role

Check the role's recommendation matrix using Model Steward:

```bash
bb swarmforge/scripts/model_steward_cli.bb role-matrix coder --include-uncertified
```

If the list is empty:
1. Verify models are registered: `bb swarmforge/scripts/model_steward_cli.bb status`
2. Certify candidates that pass your quality bar: `bb swarmforge/scripts/model_steward_cli.bb certify <provider>/<model>`

### Assignment does not change after certification

ModelFactory runs at assignment time. The decision depends on live Model Steward state. If you just certified a model, the next `assign` call will see it:

```bash
bb swarmforge/scripts/model_factory_steward_cli.bb certify anthropic/claude-opus-4-8
bb swarmforge/scripts/model_factory_cli.bb assign --mode quality
# The new assignment should reflect the fresh certification
```

### Quota exhaustion not resetting the next calendar day

Check the quota-state file:

```bash
cat .swarmforge/model-factory/quota-state.json
```

Ensure the exhausted date is before today:

```json
{"cerebras": "2026-07-21"}  # Exhausted yesterday → should reset today (2026-07-22+)
```

If it shows today's date but you expect it reset, the local calendar check may be wrong. Confirm the system date: `date +%Y-%m-%d`.

## Next Steps

- For Model Steward registry and certification workflow, see [Model Steward: Onboarding & Certification](BL-547-model-steward-overview.md).
- For swarm pack configuration and agent routing, see [Pack Configuration & Agent Roles](../reference/Specification.md#pack-configuration).
- For hot-apply and per-tier switches (Slice 2), see `specs/features/BL-525-model-factory-slice-2.feature.draft` (not yet executed).
