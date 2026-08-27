# Mono-router post-QA / idle → specifier root-intake drain (2026-07-19)

## Gap
Pack overlays told the resident to always `rotate_to_role.sh coder` after QA
and said brand-new root intake would not cold-wake the pack. Result: raw
`backlog/BL-*.yaml` intakes (e.g. BL-525) sat undrained while coder+coordinator
idled at `NO_TASK`.

## Fix
- All `*mono-router*.prompt` packs: after QA, scan backlog root; if intakes
  exist → `rotate_to_role.sh specifier` and drain; else home to coder. Same
  check when coder is idle with `NO_TASK`.
- Specifier role: draining root is valid without a mailbox parcel when rotated
  for that reason.
- Coordinator: notice root intake after close/promote; do not leave the swarm
  quiescent while root files sit undrained.

## Verify
- Pack text contains "After a parcel finishes (QA done)".
- Live rotate to specifier and confirm root BL-525 is drained to paused/ (swarm
  follow-up).
