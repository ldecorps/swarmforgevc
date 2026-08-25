# Local Ollama: mono-router vs fuller forge under CPU (BL-1142)

## Decision: mono-router stay

**Durable pack shape for this WSL/CPU host:** keep
`ollama-qwen3-mono-router` with `config rotation router` and
`config active_backlog_max_depth 1`. Do **not** graduate to a standing
fuller local forge on this host yet.

### Evidence (not cloud forge defaults)

| Signal | Observation (2026-08-25) |
|--------|---------------------------|
| BL-1127 battery | Pass cited for `ollama` / `qwen2.5-coder` (`backlog/evidence/BL-1127-coder-battery-ollama-qwen2.5-coder-20260825T180452Z.md`) |
| RAM | ~19 Gi total; ~4.8 Gi available while already under load |
| Model footprint | `qwen2.5-coder` ~4.6 Gi on disk (7.6B Q4) — concurrent standing seats would contend hard |
| Load | load average ~4.6–5.1 on a busy day-shift |
| Accept slow | Intake locked: prefer correct local seats over cloud forge depth |

A capped fuller forge remains a future option only with an explicit depth /
rotation discipline and a new human ask — not as an accidental copy of
`full-forge` / Token Plan defaults.

## Launch path (honest to the decision)

```bash
./start-swarm-ollama-qwen.sh
```

Sets `SWARMFORGE_PACK=ollama-qwen3-mono-router` and runs:

1. `local_coder_battery_staffing_gate.sh` (BL-1127)
2. `local_ollama_pack_shape_gate.sh` (BL-1142) — refuses uncapped shapes and
   forbidden substitutes

## Out of scope / must not

- **qwen-forge / Token Plan full forge** as a substitute for this local
  decision (gate refuses the pack name).
- Cold-swapping day-shift off `cursor-forge` (BL-1143).
- Instant local replies.

## Related

- [Local coder evidence bar (BL-1127)](BL-1127-local-coder-steward-evidence-bar.md)
- [Steward local model bake-off (BL-1140)](BL-1140-steward-local-model-bakeoff.md)

Acceptance:
`specs/features/BL-1142-local-ollama-mono-vs-forge-cpu.feature`
