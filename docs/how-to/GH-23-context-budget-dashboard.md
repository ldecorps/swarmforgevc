# Monitoring Agent Context Budget in the Mini App Console

Last Updated: 2026-07-23

Use the Context Budget dashboard on the Telegram Mini App console to monitor
per-agent context window utilization, token consumption, and compaction
frequency. This dashboard complements the **LLM Cost Ledger** and helps you
identify why an agent may be approaching context limits and pinpoint
optimization opportunities.

## Overview

The Context Budget dashboard reads agent telemetry from GH-22's context events
log (`.swarmforge/telemetry/context-events.jsonl`) and displays numeric
summaries:

- Agent name and model provider
- Context window utilization percentage
- Number of compactions triggered
- Time to first compaction
- Token counts (input, output, system prompt, history, tool output)
- Estimated cost (if available)

The dashboard shows one agent at a time. You switch between agents with the
picker at the top. If an agent has no recorded telemetry yet, the dashboard
shows an empty state instead of an error.

## Open the Dashboard

Open the allowlisted SwarmForge console Mini App and choose **Context Budget**.
The console links to `/context-budget` on the bridge server. The HTML shell is
publicly reachable like the other Mini App shells, but the data route requires
the console token.

## Select an Agent

Use the agent picker dropdown to choose which agent to inspect. The picker shows
only agents that have at least one recorded telemetry event.

After you select an agent, the dashboard immediately loads and displays that
agent's summary. The summary is current as of the most recent invocation event
recorded for that agent.

## Read the Summary

The dashboard displays:

- **Provider / Model** — who computed the context (e.g. `anthropic /
  claude-sonnet-5`).
- **Context Utilization (%)** — average percentage of the agent's context
  window that was in use across recorded invocations.
- **Compactions** — how many times the agent triggered a context compaction
  (history/context truncation).
- **Time to First Compaction** — milliseconds from the earliest recorded event
  to the first compaction event. `—` if no compaction occurred.
- **Token Counts** — breakdown of tokens consumed:
  - **Input** — system + history + tools + user message
  - **Output** — tokens the agent produced
  - **System Prompt** — tokens in the system prompt alone
  - **History** — tokens in conversation history alone
  - **Tool Output** — tokens from tool call responses (if applicable)
- **Estimated Cost** — USD cost estimate for the most recent invocation (if
  GH-22's recorder / your cost model provided it).

## Filter by Agent

If you need to compare two agents' utilization trends, use the picker to switch
between them. State persists across agent selections — the dashboard keeps its
URL token, so you can bookmark a specific agent's view.

## When Data is Not Present

If you select an agent with no telemetry recorded for it yet, the dashboard
shows:

```
No telemetry recorded yet for <agent name>.
```

This is the normal state until your swarm runs and records invocation events
(via `record` command or live capture wiring, once GH-22 Slice 2 lands).

**Recording test data manually:** see GH-22's how-to guide for how to use the
`record` command to add fixture events for testing.

## Future: Visualization and Live Polling (Slice 2)

Slice 1 of GH-23 (this feature) provides numeric/text display only. Future
work (Slice 2, parked in a `.feature.draft` file) will add:

- Stacked context-budget bar chart
- Timeline of compactions and utilization over time
- Top-contributors breakdown (which prompts/tools consumed the most)
- Live polling while agents are actively running (depends on GH-22 Slice 2
  capture wiring)

For now, refresh the page manually to see new data after the swarm completes a
turn.
