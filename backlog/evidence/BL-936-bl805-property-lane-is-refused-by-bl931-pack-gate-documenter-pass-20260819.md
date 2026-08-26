# BL-936-bl805-property-lane-is-refused-by-bl931-pack-gate — documenter pass — 20260819

Commit reviewed: `871261e6d5` (hardener's forward, `merge_and_process
hardender 871261e6d5`).

## What changed

`extension/test/bl805RotateGateOnUnfinishedInProcessParcel.property.test.js`'s
`makeFixture()` now writes `config rotation router` into the fixture's
`swarmforge/swarmforge.conf`, declaring the pack topology BL-931's newer,
earlier gate (`rotation-router-pack?`) checks before either of BL-805's own
gates is reached. The fixture previously declared `roles.tsv`, a tmux
socket pointer, and a launch script, but never a pack topology, so
BL-931's gate refused it before BL-805's invariants were ever exercised —
both properties failed on the very first generated shape. This is a test
fixture correction only, matching the amendment the sibling shell fixture
(`test_rotate_to_role_stuck_parcel_gate.sh`) already carries. Per the
ticket's explicit invariants: no production script changed (`handoff_lib.bb`,
`mono_router_lib.bb`, `rotate_to_role.bb`/`.sh` untouched), no env bypass or
force flag, and BL-805's own asserted invariants are unchanged — the fixture's
premise was wrong, not the behaviour under test.

## Doc surfaces checked

- `docs/reference/Specification.MD` — grepped for `BL-805`, `BL-931`,
  `rotation-router-pack`, `rotate-resident-to`: no entry documents this
  property test file's fixture contents or asserts the fixture's pack
  topology; the surrounding BL-931/BL-805 gate behaviour prose (production
  behaviour, not fixture setup) is unaffected and still accurate.
- `swarmforge/handoff-protocol.md` — no section describes this test file or
  its fixture; nothing to correct.
- No new human-facing command, setting, flow, or production behaviour was
  introduced or changed. This is an internal test-infrastructure fix
  restoring an existing test lane from red to green — the "Consumer" and
  "how it works" prose for BL-805/BL-931's actual gates was already accurate
  before this parcel and needs no edit now.
- `docs/diagrams/` — no topology, component, or boundary change; not
  touched.

## Verdict

NONE. No human-facing documentation requires a change for this parcel.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-936-bl805-property-lane-is-refused-by-bl931-pack-gate`.

By documenter.
