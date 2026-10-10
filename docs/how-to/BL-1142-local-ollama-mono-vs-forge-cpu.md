# Local Ollama: mono-router vs fuller forge under CPU (BL-1142)

Last Updated: 2026-10-10 (BL-2078: a standing forge is now allowed behind
the decode slot)

## Decision: mono-router stays the default; a capped standing forge is now allowed behind the decode slot (BL-2078)

**Durable pack shape for router packs:** keep `config rotation router`
with a shallow `active_backlog_max_depth` (one resident at a time). This
is still the default and still the only shape for any pack that does not
run behind the tool-call shim's decode slot.

**Standing forge, amended 2026-10-08/09 (BL-2077/BL-2078):** BL-1142
refused every standing-seat shape because concurrent seats would wedge
Ollama. That constraint is gone once every seat reaches Ollama through
the tool-call shim's decode slot (BL-2077: Ollama serves one decode at a
time regardless of how many seats are standing, so standing seats can run
shell/tests/git concurrently and only queue for the model itself). The
local pack-shape gate (`local_ollama_pack_shape_lib.sh`) now allows a
**capped standing forge** (positive `active_backlog_max_depth`, no more
than 8 windows, no `single_inference_slot` line) while the shim is
reachable, and refuses it — naming the missing decode slot — whenever
`SWARMFORGE_LOCAL_MODEL_SHIM=off`. Every shape BL-1142 refused before this
slice stays refused: BL-1142's five scenarios are unchanged.

**KV budget.** One decode slot is one model context: 73728 tokens on the
ISTA IQ3_S coder model, about 14.5 GB of the 16 GB card's VRAM per
`/api/ps` (2026-10-08). A second concurrent context would need about
another 2.4 GB of KV the card does not have — this is why there is still
only one decode slot, not why standing seats are refused.

### Evidence (not cloud forge defaults)

| Signal | Observation (2026-08-25) |
|--------|---------------------------|
| BL-1127 battery | Pass cited for `ollama` / `qwen2.5-coder` (`backlog/evidence/BL-1127-coder-battery-ollama-qwen2.5-coder-20260825T180452Z.md`) |
| RAM | ~19 Gi total; ~4.8 Gi available while already under load |
| Model footprint | `qwen2.5-coder` ~4.6 Gi on disk (7.6B Q4) — concurrent standing seats would contend hard |
| Load | load average ~4.6–5.1 on a busy day-shift |
| Accept slow | Intake locked: prefer correct local seats over cloud forge depth |

An **uncapped** forge, or any shape that is not the specific capped
standing pack below, remains refused: a copy of `full-forge` / Token Plan
defaults, or a standing pack with more than 8 windows, is still out of
scope — not as an accidental substitute, and not just because the shim is
reachable.

## Launch paths

### Router (default)

```bash
./start-swarm-ollama-qwen.sh
```

Sets `SWARMFORGE_PACK=ollama-qwen3-mono-router` and runs:

1. `local_coder_battery_staffing_gate.sh` (BL-1127)
2. `local_ollama_pack_shape_gate.sh` (BL-1142) — refuses uncapped shapes and
   forbidden substitutes

### Standing forge, behind the decode slot (BL-2078)

```bash
./start-swarm-ollama-ista-local-model-claude-forge.sh
```

Sets `SWARMFORGE_PACK=ollama-ista-local-model-claude-coord-forge` — the
live mono pack's seven ISTA IQ3_S seats standing (no rotation router, no
`single_inference_slot`) plus its Claude coordinator, one model load,
`active_backlog_max_depth 3` (human ruling A of A/B/C — depth 3, 2026-10-09:
the slot serves one seat at a time, so more than about three parcels in
flight mostly queue). Runs:

1. `local_coder_battery_staffing_gate.sh` (BL-1127)
2. `local_ollama_pack_shape_gate.sh` (BL-1142/BL-2078) — allows this capped
   standing shape only while the seats reach Ollama through the shim's
   decode slot (BL-2077); refuses it, naming the missing decode slot, when
   `SWARMFORGE_LOCAL_MODEL_SHIM=off`

Switching the live swarm onto this pack is the human's call, made after
this parcel lands — this doc records the allowed shape and launch command,
not a standing switch.

## Out of scope / must not

- **qwen-forge / Token Plan full forge** as a substitute for this local
  decision (gate refuses the pack name).
- An **uncapped** forge, or more than 8 standing windows (gate refuses the
  shape).
- More than one decode slot (BL-2077's notes).
- Cold-swapping day-shift off `cursor-forge` (BL-1143).
- Instant local replies.

## Related

- [Local coder evidence bar (BL-1127)](BL-1127-local-coder-steward-evidence-bar.md)
- [Steward local model bake-off (BL-1140)](BL-1140-steward-local-model-bakeoff.md)
- [Local-model seat launch, including the one decode slot (BL-2077)](BL-1052-local-model-seat-launch.md)

Acceptance:
`specs/features/BL-1142-local-ollama-mono-vs-forge-cpu.feature`,
`specs/features/BL-2078-a-standing-all-local-forge-launches-only-behind-the-decode-slot.feature`
