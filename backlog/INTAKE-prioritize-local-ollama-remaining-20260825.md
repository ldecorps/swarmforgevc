# INTAKE — Prioritize remaining local Ollama / Qwen epic slices (queue-jump)

**Source:** human via Cursor, 2026-08-25 ~19:31 BST  
**Priority:** queue-jump — ahead of ordinary paused / pipeline-note actives  
**Epic:** BL-1125 (`local-llm-swarm`) — restored under
`backlog/paused/BL-1125-epic-local-ollama-swarm-readiness.yaml`

## Why this is in front of you

Minted focus tickets **BL-1126**, **BL-1127**, and **BL-1140** are **done**.
Epic BL-1125 still has two unminted `remaining_slices`. Human ask (same
evening, after status check): **prioritize that remaining work now**.

Do not rediscover the landed chain. Do not remint BL-1126/1127/1140.

## Goal

1. **Restore / keep** epic BL-1125 in `backlog/paused/` (YAML restored by
   human if missing; do not promote the epic itself).
2. **Mint two child tickets** under `epic: local-llm-swarm` (next free ids),
   both:
   - `direction: queue-jump`
   - `priority: 0` (or lowest numeric = highest pull rank used by JumpQ)
   - `human_approval: approved`
   - `depends_on` as needed (both may depend on BL-1140; cold-swap also
     notes BL-1126+BL-1127 green already)
3. Spec + feature each slice; promote+route on the next open active slot.
   If the depth cap is full of non-JumpQ work (current actives include
   pipeline-note BL-987/988/989/999), **prefer freeing a slot** for these
   over continuing ordinary paused pull — do not starve behind Bubble /
   pipeline-note inertia.
4. Update epic `decomposes_into` + `remaining_slices` when children mint
   (drain this intake).

## Slice A — Mono-router vs full-forge under CPU

**What:** Decide and ship the durable local pack shape for this WSL/CPU
host once the coder bar has passed: stay on mono-router depth, or graduate
to a fuller forge with an explicit depth cap / rotation discipline that
does not wedge Ollama.

**Locked:** Accept slow. Prefer evidence from BL-1127 battery + live host
headroom over cloud forge defaults. Do not launch `qwen-forge` / Token Plan
full forge as a substitute for the local path.

## Slice B — Cold-swap day-shift to `ollama-qwen3-mono-router`

**What:** Explicit human authorization to cold-swap the live day-shift off
`cursor-forge` onto `./start-swarm-ollama-qwen.sh` /
`ollama-qwen3-mono-router` now that BL-1126+BL-1127+BL-1140 are green.

**Locked:**

- This is the authorized switch (plan intake said "tomorrow"; human is
  prioritizing the remaining epic **now**).
- Pack model lines must follow steward winner / no-winner-yet path from
  BL-1140 — do not reintroduce
  `human-operator-priority:ollama-local-qwen-20260825` as an authoritative
  outrank.
- Do **not** thrash to `qwen-forge` without a separate explicit human ask.
- Success = stable tool use + autonomy under latency, not instant replies.

If cold-swap is mostly ops (scripted pack switch + verify), mint the
smallest ticket that still leaves a durable runbook/evidence trail — do
not invent a large feature where a verified launch + how-to update
suffices.

## Out of scope

- Reminting landed BL-1126 / BL-1127 / BL-1140
- Promoting epic BL-1125 itself
- Instant local replies; OpenRouter as a substitute for entirely local
- New Telegram / Bubble product surface (standing freeze unchanged)

## Related

- `backlog/paused/BL-1125-epic-local-ollama-swarm-readiness.yaml`
- `backlog/done/M8/BL-1126-*.yaml`, `BL-1127-*.yaml`, `BL-1140-*.yaml`
- `.swarmforge/operator/archive/INTAKE-plan-cloud-harden-local-tomorrow-20260825.md`
- `docs/how-to/BL-1127-local-coder-steward-evidence-bar.md`
- `docs/how-to/BL-1140-steward-local-model-bakeoff.md`
- `swarmforge/packs/ollama-qwen3-mono-router.conf` / `./start-swarm-ollama-qwen.sh`

## Acceptance sketch

- Two children exist under BL-1125 with `direction: queue-jump`, approved,
  features armed.
- Coordinator pulls them ahead of ordinary paused / pipeline-note work on
  the next open slot(s).
- Epic `remaining_slices` no longer lists mintable work that is already
  ticketed.
