# Expeditor adopts (or refuses) a run ticket it cannot close (BL-1023)

## The silent no-op

A passing expedited run ended by moving its ticket `active/` → `done/`. That
move was a `when-let` over `ticket-file` — if the yaml was not in `active/`,
the body never ran, the function returned nil, and the run still reported
success.

That is the **default** for an expedited ticket: the specifier files into
`backlog/paused/`, and an expedited run has no coordinator to promote. Sibling
tickets were parked out of `active/`; the run ticket was never moved in. The
summary said pass while the yaml still read as un-started work.

## What changed

Initiation decides bookkeeping **before stages spend** (`bookkeep-plan` in
`expedite_lib.bb`, applied by `ensure-run-ticket-bookkeepable!`):

| Where the run ticket is found | Decision |
| --- | --- |
| `backlog/active/` | Ready — teardown can close it |
| `backlog/paused/` or `hold/` | **Adopt** into `active/` (skipped on `--dry-run`) |
| Missing from `{active,paused,hold}/` | **Refuse** — names the ticket and that it was not found |

`move-ticket!` always returns `{:ok? true|false …}`. Callers use
`bookkeep-move-ok?` (boolean `true` only) and `must-move-ticket!` — nil or a
truthy non-true `:ok?` cannot silent-success.

Parking other active tickets is unchanged. A dry run still moves no backlog
file.

## Operator note

You no longer need a manual promote-first workaround before
`expedite.sh BL-…` for a paused ticket. If initiation refuses, fix the filing
location (or restore a missing yaml) and re-run — nothing has spent stages yet.

Acceptance:
`specs/features/BL-1023-expeditor-refuses-a-run-ticket-it-cannot-bookkeep.feature`

Related: how-to / manual for the expeditor (`BL-567`).
