# BL-937-shell-scripts-use-bash-4-constructs-on-a-bash-32-target — documenter pass — 20260819

Commit reviewed: `8487c210b0` (hardener's forward, `merge_and_process
hardender 8487c210b0`), landing `d3e98df25a` (coder's port).

## What changed

Six tracked shell scripts (`swarmforge/scripts/swarm_dashboard.sh`,
`smoke_check_stabilize_two_pack.sh`, `reexpedite_from_wip.sh`,
`test/test_handoffd_priority_rotate_wiring.sh`,
`test/test_handoffd_aged_note_rotate_wiring.sh`,
`test/test_handoffd_starve_rotate_wiring.sh`) had every bash-4-only
`mapfile -t` site (12) replaced with a portable bash-3.2 read-loop idiom,
and both `${var^^}` case-converting expansion sites (in
`reexpedite_from_wip.sh`) replaced with `tr '[:lower:]' '[:upper:]'`. Per
the ticket's own invariant 1/2, this is a behaviour-preserving portability
port — no script gained or lost an argument, diagnostic, or exit code, and
no production logic changed while passing through. Hardener also added
`test/test_bl937_portable_mapfile_replacement.sh` as the executable proof
of behavioural equivalence, plus two evidence files recording D1/D2 (a
fixture pack-topology gap and a stale profile/smoke-check role list) that
the port surfaced but is explicitly out of scope to fix here — both raised
by `note` per the ticket's own disposition, not this parcel's concern.

## Doc surfaces checked

- `engineering.prompt` / `local-engineering.prompt` — already states "Target
  stock macOS `/bin/bash` 3.2, not Homebrew bash" as existing policy; this
  parcel makes six scripts finally COMPLY with that stated policy, it does
  not change the policy prose itself. Nothing to edit.
- `docs/how-to/BL-203-stabilize-two-pack-smoke-check.md` — the only doc
  referencing `smoke_check_stabilize_two_pack.sh`. Describes the check's
  *behaviour* (what it verifies: profile role list, daemon flag, launch.json
  wiring) which is unchanged — the port only replaced how the script reads
  command output into an array internally. No edit needed.
- Grepped `docs/` and `README.md` for `mapfile`, `readarray`,
  `reexpedite_from_wip`, and the three `test_handoffd_*_rotate_wiring.sh`
  names: no other doc references these scripts' internals.
- No new human-facing command, setting, or flow was introduced. This is an
  internal implementation-detail fix (array-reading idiom) restoring three
  wiring tests and two operator scripts from "cannot run on this host at
  all" to working — a portability repair, not a behaviour or interface
  change for a doc reader.
- `docs/diagrams/` — no topology, component, or boundary change; not
  touched.

## Verdict

NONE. No human-facing documentation requires a change for this parcel.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-937-shell-scripts-use-bash-4-constructs-on-a-bash-32-target`.

By documenter.
