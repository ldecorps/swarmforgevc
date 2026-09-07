# A ticket that cannot advance does not hold a slot (BL-1479)

## The gap

`backlog_depth_lib.bb`'s `count-active-tickets` counts every YAML in
`backlog/active/` against `active_backlog_max_depth`, but nothing ever
moved a ticket back OUT of `active/` except QA approval (to `done/`) or a
human hand. `status: blocked` was read only by `promotion_gates_lib.bb`
(never auto-promoted, BL-1145) and `chase_sweep_lib.bb`'s
`parked-ticket?` (the dropped-parcel nag is suppressed, BL-1301);
`not_before` (BL-1469) is read only at promotion. So a ticket that became
unworkable AFTER promotion — a dependency that itself got paused, or a
mutation-cooldown date pushed out from under it — held its slot
indefinitely. Measured 2026-09-07: two of five active slots (40% of the
swarm's WIP cap) were held this way for one and two days respectively,
while roughly thirty approved, workable tickets sat in `backlog/paused/`.

## What changed

| Piece | Change |
| --- | --- |
| `chase_sweep_lib.bb` | `parked-active-items`, `park-commit-message`, `park-ticket!` — decide which active tickets are parkable, then move and commit each one |
| `handoffd.bb` | `parked-active-sweep!` runs the decision + action on the daemon's shared cadence |
| `swarmforge/scripts/test/suite-manifest.tsv` | the new runners enrolled |

A ticket is parkable when it declares `status: blocked` or a `not_before`
later than today (`parked-active-condition`) — reusing `parked-ticket?`
and BL-1469's `not-before-refusal` rather than re-parsing either field a
second way. A `not_before` of exactly today is workable: the field is an
EARLIEST date, not a park by itself.

A parkable ticket is moved ONLY if no role's mailbox (`new` or
`in_process`, master and every worktree) currently holds a parcel naming
it (`parked-active-items`'s `live-ticket-ids` set, injected by the caller
from the same live-mail-trail scope the dropped-parcel sweep already
uses) — a ticket with a parcel anywhere is left in `active/` whatever its
status, so the 2026-08-31 STEERING rule against demoting in-flight work
holds by construction. A refusal is a daemon log line, once per ticket
and condition, never a note to the coordinator every cycle.

The move itself (`park-ticket!`) is `git mv backlog/active/<file>
backlog/paused/<file>` through `commit_integrity_cli.bb`, one ticket per
commit, subject `Park <id>: active -> paused (<condition>)` — the YAML's
bytes are untouched, so nothing needs re-approving: status, `not_before`,
`depends_on`, notes, approval and bounce history all survive the move
unchanged. A commit refusal (a concurrent writer holding the lock) rolls
the staged `git mv` back via `rollback-park-mv!` rather than leaving a
half-renamed ticket staged in the shared index — a `git reset` of both
paths back to their HEAD state, then a `git checkout` of the active-side
path, then deleting the now-untracked paused-side file; a bare `git
checkout -- old new` after the `mv` reads from the index, not HEAD, and
errors on the already-removed old path without ever reaching the new one
(the architect's own bounce, `backlog/evidence/BL-1479-bounce-20260907.md`
D1).

The sweep sends exactly one `note` to the coordinator per park, naming the
ticket and its condition; a parked ticket re-enters promotion by the
ordinary rules once its condition clears — `promotion_gates_lib.bb`'s
`not_before` gate admits it after the date, and for `status: blocked` the
coordinator clears the field when the dependency lands, exactly as
before. This ticket adds no auto-unblock and does not change what
`active/` means for the dispatch-gap or unassigned-active sweeps, which
still count every file in the folder unconditionally.

## Related

- BL-1301 (`specs/features/BL-1301-a-parked-ticket-is-not-a-dropped-parcel.feature`,
  documented in `docs/reference/Specification.MD`) — the `status: blocked`
  read this sweep reuses (`parked-ticket?`) was built there to suppress
  the dropped-parcel chase's own nag on a deliberately parked ticket;
  this sweep is what actually moves the ticket out of `active/` in the
  first place.
- [BL-1145: open-slot nudge skips `type: epic` trackers](BL-1145-open-slot-nudge-skips-epic-trackers.md) —
  the `not_before` gate this sweep's `not-before-refusal` reuse shares
  with `promotion_gates_lib.bb`'s promotion chain (BL-1469).
- `backlog/STEERING.md`'s 2026-09-07 directive records the interim hand
  rule this sweep mechanises, and the 2026-08-31 section this sweep never
  violates (a ticket with a parcel in flight is never demoted).

Acceptance:
`specs/features/BL-1479-a-ticket-that-cannot-advance-does-not-hold-a-slot.feature`.
