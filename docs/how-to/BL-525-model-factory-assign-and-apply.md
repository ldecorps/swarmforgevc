# ModelFactory: Assigning and Applying Agent Models

Last Updated: 2026-07-23

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
   cd /path/to/target-repo
   bb /path/to/swarmforge/swarmforge/scripts/model_factory_cli.bb assign --mode cheap > ./assignment.json
   ```

2. **Review the assignment** to confirm models and providers:
   ```bash
   cat assignment.json
   # Output example:
   # {
   #   "coder": { "agent": "anthropic", "provider": "openai", "model": "gpt-4", "reason": "fallback: cerebras exhausted, quality-floor met", "policy": "cheap" },
   #   "coordinator": { "agent": "anthropic", "provider": "anthropic", "model": "claude-haiku-4.5", "reason": "cheapest eligible", "policy": "cheap" },
   #   ...
   # }
   ```

3. **Stop the running swarm** and relaunch with the assignment overlay:
   ```bash
   ./swarmforge/scripts/kill_all_swarm.sh <repo>
   cd /path/to/swarmforge
   # Apply the frozen assignment as an overlay:
   cp /path/to/target-repo/assignment.json .swarmforge/model-factory/assignment.json
   ./swarm <target-repo>
   ```

4. **Verify the new roles are live** by checking pane titles in tmux:
   ```bash
   tmux list-panes -t swarmforge -F '#{pane_title} [#{pane_current_command}]'
   # Each pane title should match the assigned model from the assignment.json
   ```

### Reference: Default launch seam

For scripted cold-apply workflows, the launch helper is available:

```bash
swarmforge/scripts/model_factory_default_launch_seam.sh \
  --assignment-json /path/to/assignment.json \
  --target <optional-pack-override>
```

## Cold-Apply vs Hot-Swap (Slice 2)

**Slice 1 (current)**: Cold-apply requires stopping the swarm and restarting it entirely, but is simple and stable. Use this when you want to change models and can tolerate a brief pause in your work.

**Slice 2 (planned)**: Hot-swap will respawn only the affected roles without stopping the entire swarm, preserving in-flight parcels and minimizing disruption. This capability is tracked separately and is not yet available.

For now, use cold-apply for model changes.

## Integration with Model Steward

ModelFactory consumes the **Model Steward** registry and certification status. If you need to:

- **Add or update certified models**: see [Model Steward: Onboarding, Certification, and Role Recommendations](./BL-547-model-steward-overview.md)
- **Understand role-specific models and cost tiers**: check the Steward registry at `.swarmforge/model-steward/registry.json` (populated from `swarmforge/model-steward/seed/models.seed.json`)
- **Override certification for testing**: use the `--override-uncertified` flag with explicit caution, as it bypasses quality gates

## Troubleshooting

### Assignment returns no viable models

If `assign` fails or returns an empty map:
1. Verify the Steward registry is populated: `cat .swarmforge/model-steward/registry.json`
2. Check provider credentials are set in the launch environment (`CEREBRAS_API_KEY`, `OPENAI_API_KEY`, etc.)
3. Confirm role-specific cost floors are met by at least one certified candidate

### Quota-state file not updating

The quota-state file (`.swarmforge/model-factory/quota-state.json`) is populated at runtime when providers signal exhaustion (HTTP 429 errors, etc.). If it's not updating:
1. Check provider logs in the running swarm (tail the role panes)
2. Manually inject test states using `QUOTA_STATE_OVERRIDE` (see Testing section above)
3. For live debugging, edit `.swarmforge/model-factory/quota-state.json` directly and re-run `assign`
