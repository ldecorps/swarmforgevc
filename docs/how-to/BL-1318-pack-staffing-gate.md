# BL-1318 — Pack staffing gate: refuse an uncleared seat before launch

## Why

Global `certified` is not per-role clearance. A model can be registry-
`certified` on the strength of one role's evidence (e.g. `coder-gate`,
`opencode-zen-live`, `no-scheduling`) while its `QA-gate` still reads
`human-verdict-pending` and it appears on only the `:coder` role-matrix. A
pack `window` line pinning that model to a different role (QA, say) bypassed
ModelFactory's steward consult entirely — `./swarm --pack …` staffed the seat
with no check at all.

## What the gate does

Every pack window, on every `./swarm --pack …` launch (and every materialised
`.swarmforge/launch/<role>.sh` the mono-router's `rotate_to_role.sh` re-execs),
passes through `pack_staffing_gate` in `swarmforge/scripts/swarmforge.sh` —
the one call site, inside `parse_config`'s per-window loop. It resolves the
window's provider/model identity and requires all three:

- the model is ranked on that role's role-matrix with battery/scorecard
  evidence;
- the role's compliance gate for that model is decided **pass** (not
  `human-verdict-pending`);
- `assignment-eligible?` holds.

An identity the resolver cannot map (provider/model unrecognized) **refuses**
— an entry the table doesn't cover never staffs by default.

The gate only reads steward evidence (the runtime registry, or the committed
seed if no live registry exists, plus scorecards). It never writes the
registry, a scorecard, or a role matrix, and never runs a compliance battery
at launch time.

## Refusal

```
pack staffing gate refused role 'QA' (line 7): opencode/nemotron-3-ultra-free
failed check 'QA-gate'. Run: model-steward status opencode/nemotron-3-ultra-free
```

The launch exits before any tmux window exists.

## Operator escape hatch

```bash
PACK_STAFFING_SKIP_GATE=1 ./swarm <root> --pack <pack.conf>
```

Same shape as BL-1127's `LOCAL_CODER_BATTERY_SKIP_GATE=1`. It stages the seat
as an **override**, not a pass — always printed as a loud warning naming the
role, the identity, and the failing check (or, with no steward evidence
readable at all, a warning that no evidence exists). An override is never
indistinguishable from a pass in either the operator-facing output or the
recorded decision.

## Identity resolution shapes

Seeded from the live packs, table-driven in `pack_staffing_gate_lib.bb`:

| Window line | Resolved identity |
|---|---|
| `cursor … --model auto` | `cursor/auto` |
| `claude … --model claude-sonnet-5` | `anthropic/claude-sonnet-5` |
| `aider --model openai/qwen3.7-plus --openai-api-base <aliyuncs base>` | `qwen/qwen3.7-plus` (provider from the api-base host, not the `openai/` prefix) |

## Related

- [Model steward overview](BL-547-model-steward-overview.md) — the
  registry/role-matrix/compliance-gate evidence this gate reads.
- [Local coder evidence bar](BL-1127-local-coder-steward-evidence-bar.md) —
  the precedent this gate's escape hatch mirrors
  (`LOCAL_CODER_BATTERY_SKIP_GATE=1` → `PACK_STAFFING_SKIP_GATE=1`).

## Not this slice

- Auto-running the full compliance battery at launch time — capture stays
  operator/steward-assigned.
- Recruiter/discovery work — this is a staffing refusal, not a new qualify
  path.
- Certifying `opencode/nemotron-3-ultra-free` for QA — a steward/operator
  action requiring battery evidence that does not exist yet.
