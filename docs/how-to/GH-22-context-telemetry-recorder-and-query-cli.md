# Context Telemetry: Recording and Querying Agent Invocations

Last Updated: 2026-07-23

SwarmForge's **Context Telemetry** subsystem records per-invocation event data for each agent (input/output token counts, context window utilization, compaction events) and provides a query CLI to summarize telemetry across recorded invocations.

## Overview

Context telemetry tracks **invocation events** — snapshots of token usage and context state whenever an agent completes a conversation turn. Events are appended to an immutable JSONL log at `.swarmforge/telemetry/context-events.jsonl`. The CLI provides two operations:

- **`record`** — Append a new invocation event to the telemetry log.
- **`summary`** — Query the log for telemetry statistics scoped to an agent or session.

## Recording an Invocation Event

When an agent completes a turn, record the event with its context telemetry:

```bash
bb swarmforge/scripts/context_telemetry_cli.bb record \
  --agent <agent-name> \
  --role <role> \
  --session-id <session-id> \
  --timestamp <ISO-8601-timestamp> \
  --input-tokens <number> \
  --output-tokens <number> \
  --context-utilization-pct <0-100> \
  --provider <provider> \
  --model <model> \
  [--tool-output-tokens <number>] \
  [--prompt-engine-tokens <number>] \
  [--system-prompt-tokens <number>] \
  [--history-tokens <number>] \
  [--compaction true|false] \
  [--estimated-cost-usd <number>]
```

### Example

```bash
bb swarmforge/scripts/context_telemetry_cli.bb record \
  --agent coder \
  --role coder \
  --session-id tmux:sess-coder:0 \
  --timestamp 2026-07-23T12:34:56Z \
  --input-tokens 52000 \
  --output-tokens 8000 \
  --context-utilization-pct 68 \
  --provider anthropic \
  --model claude-sonnet-5
```

Output:
```
recorded coder tmux:sess-coder:0 2026-07-23T12:34:56Z
```

### Required Fields

- **`--agent`** — Agent name (e.g. `"coder"`, `"architect"`).
- **`--role`** — Pipeline role at the time of invocation (e.g. `"coder"`, `"hardener"`).
- **`--session-id`** — Unique session identifier for this agent run (e.g. tmux session ID or a swarm session UUID).
- **`--timestamp`** — ISO-8601 timestamp of the invocation. **The CLI does not read the wall clock; you must supply this.** Example: `2026-07-23T12:34:56Z`.
- **`--input-tokens`** — Tokens consumed by input (system prompt + context + user message).
- **`--output-tokens`** — Tokens produced by the agent.
- **`--context-utilization-pct`** — Context window utilization as a percentage (0–100).
- **`--provider`** — Provider name (e.g. `"anthropic"`, `"openrouter"`).
- **`--model`** — Model identifier (e.g. `"claude-sonnet-5"`, `"claude-opus-4-8"`).

### Optional Fields

- **`--tool-output-tokens`** — Tokens returned by tool calls (if applicable).
- **`--prompt-engine-tokens`** — Tokens consumed by prompt templating or adaptation.
- **`--system-prompt-tokens`** — Tokens in the system prompt (for analysis).
- **`--history-tokens`** — Tokens in conversation history (for analysis).
- **`--compaction`** — `true` if this invocation triggered a context compaction, `false` otherwise. Defaults to `false`.
- **`--estimated-cost-usd`** — Estimated cost of this invocation in USD (caller-supplied; Slice 1 has no pricing logic).

### Validation

The CLI validates required fields and data types. Invalid records are rejected:

```bash
# Missing required field — rejected
bb swarmforge/scripts/context_telemetry_cli.bb record \
  --agent coder \
  --role coder
# Error: validation error: missing required field --timestamp
```

```bash
# Non-numeric input-tokens — rejected
bb swarmforge/scripts/context_telemetry_cli.bb record \
  --agent coder \
  --role coder \
  --session-id sess-1 \
  --timestamp 2026-07-23T12:34:56Z \
  --input-tokens "abc" \
  --output-tokens 1000 \
  --context-utilization-pct 50 \
  --provider anthropic \
  --model claude-sonnet-5
# Error: validation error: input-tokens must be numeric
```

```bash
# Non-finite numeric values (NaN, Infinity) — rejected
bb swarmforge/scripts/context_telemetry_cli.bb record \
  --agent coder \
  --role coder \
  --session-id sess-1 \
  --timestamp 2026-07-23T12:34:56Z \
  --input-tokens "Infinity" \
  --output-tokens 1000 \
  --context-utilization-pct 50 \
  --provider anthropic \
  --model claude-sonnet-5
# Error: validation error: input-tokens must be a finite number (not NaN or Infinity)
```

## Querying Telemetry Summary

Retrieve aggregated statistics from the telemetry log:

```bash
bb swarmforge/scripts/context_telemetry_cli.bb summary --agent <agent-name> [--session-id <session-id>]
```

### Example 1: Summary for an Agent (All Sessions)

```bash
bb swarmforge/scripts/context_telemetry_cli.bb summary --agent coder
```

Output (JSON):
```json
{
  "agent": "coder",
  "session_id": null,
  "event_count": 12,
  "compaction_count": 3,
  "avg_context_utilization_pct": 65.4,
  "time_to_first_compaction_ms": 45000
}
```

- **`event_count`** — Total invocations recorded for `"coder"` across all sessions.
- **`compaction_count`** — How many of those invocations triggered a compaction.
- **`avg_context_utilization_pct`** — Mean context utilization over all invocations.
- **`time_to_first_compaction_ms`** — Milliseconds from the earliest recorded event to the first compaction event. `null` if no compaction occurred.

### Example 2: Summary for an Agent within a Session

```bash
bb swarmforge/scripts/context_telemetry_cli.bb summary --agent coder --session-id tmux:sess-coder:0
```

Output (JSON):
```json
{
  "agent": "coder",
  "session_id": "tmux:sess-coder:0",
  "event_count": 8,
  "compaction_count": 2,
  "avg_context_utilization_pct": 68.2,
  "time_to_first_compaction_ms": 30000
}
```

Scoped to a specific session, the summary includes only events for that session.

## Data Locations

- **Telemetry schema (reference)** — `swarmforge/telemetry/schema/context-event.schema.json`
- **Runtime log** — `.swarmforge/telemetry/context-events.jsonl` (gitignored; initialized empty on first use)
- **CLI source** — `swarmforge/scripts/context_telemetry_cli.bb` (thin wrapper over `context_telemetry_lib.bb` and `context_telemetry_store.bb`)

## Testing and Isolation

When testing or running acceptance tests, override the default log location so tests do not mutate the repository's production telemetry:

```bash
export CONTEXT_TELEMETRY_STATE_DIR=/tmp/test-telemetry
bb swarmforge/scripts/context_telemetry_cli.bb record ...
```

The CLI will create the directory if it does not exist and append events to `.swarmforge/telemetry/context-events.jsonl` within the specified state directory.

## Future: Live Capture Integration (GH-22 Slice 2)

This ticket (GH-22 Slice 1) provides the recorder and query CLI only. **Live capture wiring** — automatically invoking the record command at agent-invocation call sites — is planned as GH-22 Slice 2 and is documented in `GH-22-context-telemetry-slice-2.feature.draft`.

