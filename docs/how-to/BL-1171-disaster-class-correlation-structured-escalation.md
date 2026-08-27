# Disaster-class correlation and structured escalation (BL-1171)

When babysitterd sees **multiple correlated CRITs in one sweep** — handoffd
down, ≥3 half-launch roles, and swarm-starved — it rolls them into **one**
`disaster-class` escalation instead of N undifferentiated symptom lines.

## What the operator sees

The operator queue receives a single `BABYSITTER_ESCALATION` with subject
`disaster-class`. The `detail` field is JSON the prompt can parse:

| Field | Meaning |
| --- | --- |
| `failure_class` | e.g. `starvation-cascade` or `handoffd-parse-dead` |
| `likely_causes` | Ordered hypotheses — not a dump of raw check keys |
| `suggested_actions` | Each action names an **owner** (`babysitterd`, `operator`, `human`) |
| `evidence_paths` | Under `.swarmforge/` — log paths, streak file, incident artifact |
| `summary` | One-line human headline |

## Starvation cascade (`starvation-cascade`)

Triggers when one sweep reports handoffd down, swarm-starved, and at least
three `proc-*` half-launch findings. Bounded auto-repair from BL-1169 may
still run alongside the CRIT — the disaster-class line replaces duplicate
symptom spam, not the repair posture.

## Unrecoverable parse error (`handoffd-parse-dead`)

When handoffd fails startup with a parse error in the log snapshot, babysitterd
emits a **diagnose-only** disaster-class escalation: names the log path, says
**human hotfix required**, and **suppresses** bounded auto-repair for that
sweep (no repair storm).

## Verify

```bash
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1171-disaster-class-correlation-structured-escalation.feature
bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb
```

Related: [babysitterd runbook](BL-611-babysitterd-runbook.md) (half-launch repair BL-1169),
[Escalation-driven operator wake model](BL-653-operator-escalation-driven-wake-model.md).
