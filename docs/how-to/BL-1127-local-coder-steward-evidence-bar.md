# BL-1127 — Local coder evidence bar before staffing a local forge

## Battery (claim / edit / test / handoff)

```bash
# Fixture / CI (harness seam — does not run live phases):
bash swarmforge/scripts/local_coder_battery.sh --result=pass

# Live on this host (hermetic claim→edit→test→handoff + Ollama model probe):
LOCAL_CODER_BATTERY_MODEL=qwen2.5-coder bash swarmforge/scripts/local_coder_battery.sh
```

Writes `backlog/evidence/BL-1127-coder-battery-<provider>-<model>-<stamp>.md`
listing each phase. Exit 0 only on pass.

## Steward eligibility

Pure helpers in `model_steward_lib.bb`:

- `bl1127CoderBatteryEligibility` / `bl1127-coder-battery-eligibility`
- `apply-coder-battery-to-scorecard`

Pass cites the evidence path on the coder role ranking; fail/absent → ineligible.

## Staffing gate (live launch)

`./start-swarm-ollama-qwen.sh` calls
`swarmforge/scripts/local_coder_battery_staffing_gate.sh`, which requires a
cited **pass** evidence path (`LOCAL_CODER_BATTERY_EVIDENCE_PATH` or the newest
`BL-1127-coder-battery-*.md`). Fail/absent refuses to staff. Emergency only:
`LOCAL_CODER_BATTERY_SKIP_GATE=1`.

## Local launch (no cloud Token Plan keys)

```bash
./start-swarm-ollama-qwen.sh
```

Pack: `swarmforge/packs/ollama-qwen3-mono-router.conf` (Ollama OpenAI-compat on
`127.0.0.1:11434`). Does not require `QWEN_API_KEY` / Bailian Token Plan keys.

## Pack staffing gate (BL-1318)

This ticket's `LOCAL_CODER_BATTERY_SKIP_GATE=1` escape hatch is the shape
precedent for [Pack staffing gate](BL-1318-pack-staffing-gate.md)'s
`PACK_STAFFING_SKIP_GATE=1` — the same steward evidence checked here for the
coder role now gates every pack `window` line for every role, at `./swarm
--pack …` launch time.

## Steward bake-off (BL-1140)

For choosing **which** local model leads the role-matrix (and whether the
Ollama pack `--model` matches), see
[Steward-driven local model bake-off](BL-1140-steward-local-model-bakeoff.md).
Battery evidence from this ticket feeds that ranking; revoked
`human-operator-priority:ollama-local-qwen-20260825` cannot outrank a pass.
