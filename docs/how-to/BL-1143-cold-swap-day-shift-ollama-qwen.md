# Cold-swap day-shift to ollama-qwen3-mono-router (BL-1143)

Human-authorized cut-over of the live day-shift off `cursor-forge` onto the
local Ollama mono-router path now that BL-1126 / BL-1127 / BL-1140 (and
BL-1142 mono decision) are green.

Success = stable tool use and autonomy under latency — **not** instant replies.

## Preconditions

1. BL-1127 coder battery **pass** evidence (staffing gate).
2. Pack shape is mono-router depth 1 (BL-1142 gate).
3. Steward local-pack-align is `:aligned` or `:no-winner-yet` (BL-1140).
   Never treat `human-operator-priority:ollama-local-qwen-20260825` as an
   authoritative outrank.
4. Do **not** thrash to `qwen-forge` / Token Plan full forge.

## Verify (safe — does not kill panes)

```bash
bash swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh "$(pwd)" --verify
```

Writes:

- `.swarmforge/day_shift_pack` → `ollama-qwen3-mono-router`
- `backlog/evidence/BL-1143-cold-swap-<stamp>.md` citing the gates

## Execute (destroys live day-shift panes)

Run only when ready to cut over (typically after the coder tip has handed
off). From the **main checkout** (not a role worktree):

```bash
bash swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh /path/to/swarmforgevc --execute
```

This runs `kill_all_swarm` then `./start-swarm-ollama-qwen.sh` (Ollama
OpenAI-compat on `127.0.0.1:11434`, pack `ollama-qwen3-mono-router`).

## Rollback to cursor-forge

```bash
./stop-swarm.sh
# or: bash swarmforge/scripts/kill_all_swarm.sh "$(pwd)"
SWARMFORGE_PACK=cursor-forge ./start-swarm.sh
# or the operator's usual cursor-forge bring-up
```

Requires Cursor seat credentials / `cursor-agent` as before the swap.

## Related

- [Local coder evidence bar (BL-1127)](BL-1127-local-coder-steward-evidence-bar.md)
- [Steward local model bake-off (BL-1140)](BL-1140-steward-local-model-bakeoff.md)
- [Local Ollama mono vs forge (BL-1142)](BL-1142-local-ollama-mono-vs-forge-cpu.md)

Acceptance:
`specs/features/BL-1143-cold-swap-day-shift-ollama-qwen.feature`
