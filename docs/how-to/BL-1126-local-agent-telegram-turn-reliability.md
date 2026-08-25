# Local Agent Telegram turn reliability (BL-1126)

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

- Real turns stream NDJSON progress (`POST /turn/stream`) so Telegram is not
  silent while Ollama runs.
- Empty / whitespace model replies nudge once, then fail closed with a clear
  non-empty error — the topic is never left awaiting a missing final.
- `TurnGate` plus turn / idle / per-chat socket deadlines abort wedged Ollama
  calls and surface an explicit timeout; later probes still work without a bot
  restart.

## Bring-up

```bash
bash swarmforge/scripts/local_agent/launch_local_agent.sh
```

Default listen: `http://127.0.0.1:18765` (`/health`, `/turn`, `/turn/stream`).
State/logs: `.swarmforge/local-agent/` (`LOCAL_AGENT_STATE_DIR` overrides).

## Ops knobs

| Env | Default | Role |
| --- | --- | --- |
| `LOCAL_AGENT_TURN_DEADLINE` | `300` | Wall-clock seconds for one Telegram turn (`0` disables) |
| `LOCAL_AGENT_TURN_IDLE` | `45` | Abort if no progress events for this many seconds |
| `LOCAL_AGENT_OLLAMA_TIMEOUT` | `90` | Per-`/api/chat` socket wait |
| `LOCAL_AGENT_MODEL` | launch script sets HF Qwen tag | Chat model id |
| `LOCAL_AGENT_THINK` | `false` | Qwen3 think dial (`false`/`true`/`low`…`max`) |
| `LOCAL_AGENT_NUM_CTX` / `NUM_PREDICT` | `2048` / `256` | Ollama options |
| `LOCAL_AGENT_KEEP_ALIVE` | `30m` | Keep model loaded after preload/turn |
| `LOCAL_AGENT_PRELOAD` | `1` | Launch-time warm load (avoids cold first turn) |
| `LOCAL_AGENT_HOST` / `PORT` | `127.0.0.1` / `18765` | HTTP bind |
| `LOCAL_AGENT_ROOT` | repo root | Tool filesystem jail |

## When a turn times out

1. Expect an explicit timeout/failure receipt in the Local Agent topic — not
   silence.
2. Send a fast-path probe (Ping / status). If that replies, the bot is still
   live; shorten the ask or raise `LOCAL_AGENT_TURN_DEADLINE` /
   `LOCAL_AGENT_OLLAMA_TIMEOUT` for heavy CPU turns.
3. Check `.swarmforge/local-agent/server.log` if `/health` is down.

## Acceptance

`specs/features/BL-1126-local-agent-telegram-turn-reliability.feature`
