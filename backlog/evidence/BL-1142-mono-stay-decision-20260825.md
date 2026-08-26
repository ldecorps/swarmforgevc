# BL-1142 — Local Ollama pack-shape decision (mono stay)

- stamped: 20260825T190100Z
- decision: mono-router stay
- pack: ollama-qwen3-mono-router
- depth_cap: 1
- rotation: router

## Evidence cites

- BL-1127 battery pass:
  `backlog/evidence/BL-1127-coder-battery-ollama-qwen2.5-coder-20260825T180452Z.md`
- Host headroom (WSL, 2026-08-25 evening): ~4.8 Gi available RAM of 19 Gi;
  load average ~4.6–5.1; `qwen2.5-coder` ~4.6 Gi model already resident.
- Intake lock: accept slow; do not use qwen-forge / Token Plan full forge
  as the local substitute.

## Gate

`swarmforge/scripts/local_ollama_pack_shape_gate.sh` enforces mono-router
classification and refuses uncapped multi-seat + forbidden substitute names.
