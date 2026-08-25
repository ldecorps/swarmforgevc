# BL-1126 — Local Agent Telegram turns under Ollama latency

Real Qwen turns on CPU take tens of seconds to minutes — that is expected.
Silent hangs, empty finals, and front-desk wedges are not.

## Fast-path vs real-turn

| Class | Examples | Ollama? | Latency |
| --- | --- | --- | --- |
| Fast-path probes | Ping, hi, hello, status, health | **No** | tens of ms |
| Real turns | Any other question | Yes | 4–20s+ on CPU (often longer) |

`fast_path_reply()` in `swarmforge/scripts/local_agent/agent_core.py` owns the
probe set. Instant Ping ≠ instant real Qwen.

## Progress and recovery

- Real turns stream NDJSON progress (`/turn/stream`) so Telegram is not silent.
- Empty / whitespace model replies nudge once, then fail closed with a clear
  non-empty error — the topic is never left awaiting a missing final.
- `TurnGate` + `LOCAL_AGENT_TURN_DEADLINE` / idle / socket deadlines abort wedged
  Ollama calls and surface an explicit timeout; later probes still work.

## Ops knobs

See env vars in `agent_core.py` (`LOCAL_AGENT_TURN_DEADLINE`,
`LOCAL_AGENT_TURN_IDLE`, `LOCAL_AGENT_OLLAMA_TIMEOUT`, …).
