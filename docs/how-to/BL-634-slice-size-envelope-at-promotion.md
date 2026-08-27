# Slice size envelope at promotion (BL-634)

At promotion, the coordinator refuses oversized **declared** slice envelopes
before a coder starts — sharing BL-626's `promotion_gates_lib.bb` chokepoint,
not a parallel gate.

## Why

BL-590 "slice 1" shipped 1929 insertions against a 65-insertion median. The
gate acts on **declared estimates** at promotion (when splitting is still
cheap), not post-hoc actuals.

## Defaults (2026-07-25 distribution)

| Threshold | Insertions | Meaning |
| --- | --- | --- |
| Median | 65 | Normal band — no added friction |
| p90 flag | 514 | Refuse unless `size_envelope_decision` recorded |
| p99 stop | 1502 | Hard stop reference |

Override via `swarmforge.conf`:

```text
config slice_size_p90_flag 100
```

## Ticket fields

| Field | Role |
| --- | --- |
| `size_envelope_insertions:` | Declared expected insertions |
| `slice_size_envelope: high` | High band (or `mutation_cost: high`) |
| `size_envelope_decision: justified` | Split-or-justify clears refusal |

At QA, record actuals with `slice_size_envelope_gate_lib/format-actual-size-recording`
→ `actual_insertions` / `actual_files` on the ticket (calibration loop for BL-635).

## Operator

When promote refuses with `REFUSE|slice_size_envelope|…`, either split the
ticket, record an explicit justify decision on the yaml, or lower the declared
envelope. Median-shaped slices promote unchanged.

Related: [BL-626 acceptance gate](BL-626-promotion-gate-rejects-unmaterialized-feature-draft.md),
[lessons from BL-590](../explanation/lessons-2026-07-25-green-suites-that-proved-nothing.md).
