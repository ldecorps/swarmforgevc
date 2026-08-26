# Babysitter rotate-not-honored skips standing packs (BL-1129)

Babysitter check 9 (`check-rotate-not-honored`) CRITs when a completed
`rotate_to_role` note was not reflected in
`.swarmforge/mono-router-active-role`. On **standing** packs every role has
its own pane; `rotate_to_role.sh` refuses and an empty active-role file is
expected — the CRIT was a false positive that renudged forever.

## Fix

Gate the check on the same BL-804 topology flag used elsewhere:
`rotation-router?`. Standing (non-rotating) packs suppress the finding
entirely. Rotating / mono-router packs keep the existing CRIT when a rotate
note was not honored.

Do not re-issue `rotate_to_role` from the coordinator on standing packs.

## Related

- Topology: [BL-804](../../specs/features/BL-804-babysitter-mono-router-topology-awareness.feature) /
  [BL-1020](BL-1020-stale-mono-router-marker-is-not-topology.md)
- Runbook check table: [BL-611](BL-611-babysitterd-runbook.md)

Acceptance:
`specs/features/BL-1129-babysitter-rotate-not-honored-skips-standing.feature`
