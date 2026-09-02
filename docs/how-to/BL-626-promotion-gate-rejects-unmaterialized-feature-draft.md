# Promotion refuses a missing or draft acceptance feature (BL-626)

## The gap

A ticket's `acceptance:` field advertises the contract the coder runs and
QA gates on. When it pointed at a missing `.feature`, or at a parked
`.feature.draft`, promotion still succeeded — so work could reach `done/`
with the stated acceptance never executed (origin: BL-441).

## What changed

| Piece | Change |
| --- | --- |
| `promotion_gates_lib.bb` | Blocking gate `acceptance` after `human_approval`, before `depends_on` |
| `promotion_gates_cli.bb` | Passes `:root`; new `audit-acceptance` command |
| `promote_and_route_next.sh` `is_buildable` | Explicit path is authoritative — no same-id sibling glob rescue; drafts refuse |

Refusal shapes (the message names the path):

1. Pointer to a `.feature` with only its `.feature.draft` beside it
2. Pointer that *is* a `.feature.draft`, **parked** — no conversion pinned
   (see [BL-1340](BL-1340-promotion-admits-a-self-converting-acceptance-draft.md):
   a **self-converting** draft, pinned via `required_wiring:`, is admitted
   here and refused instead at the documenter→QA edge if it arrives
   unconverted)
3. Pointer to a `.feature` with no matching file at all

Still promotes unchanged: a resolving `.feature` pointer, and prose
`acceptance:` with no file path (chores/docs are not forced into a feature).

A same-prefix sibling `specs/features/<id>-other.feature` does **not**
rescue a dangling explicit pointer.

## Operator note

When auto-pick or by-name promote refuses with `REFUSE|acceptance|…`, fix the
pointer or materialise the feature, then retry. To list the whole exposure
read-only against live `paused/` + `active/`:

```bash
bb swarmforge/scripts/promotion_gates_cli.bb audit-acceptance <project-root>
```

Exit `2` lists every dangling pointer; exit `0` prints `ok`.

Mint-time sibling: [BL-1027](BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.md).
Untracked working-tree half: [BL-533](BL-533-spec-commit-and-runtime-wiring-exit-gates.md).
Handoff-time existence check: [BL-880 in BL-531](BL-531-handoff-refusal-remedies.md#acceptance-pointer-refusals-bl-880).
Self-converting draft admission + QA-edge backstop: [BL-1340](BL-1340-promotion-admits-a-self-converting-acceptance-draft.md).

Acceptance:
`specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`

Diagram note: `docs/diagrams/swarm-flow.mmd` (promotion edge lists
`acceptance` among refusing gates).
