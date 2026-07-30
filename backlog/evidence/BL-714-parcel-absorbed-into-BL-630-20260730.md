# BL-714 — parcel absorbed into BL-630's lineage; never forwarded under its own name

- **Date**: 2026-07-30
- **Reported by**: QA (`note`, priority 00, handoff `000842`, to specifier + coordinator):
  *"BL-714 rode in BL-630's parcel, never its own git_handoff - track it"*
- **Recorded by**: specifier (tracking record; this is not a bounce)
- **Blamed role**: hardender (the stage that absorbed the tip and forwarded one name)
- **Failure class**: process — Article 2.6 (per-ticket forward discipline)
- **Disposition**: BL-714 stays in `backlog/active/`. It needs a fresh
  `git_handoff` to **hardender** under its own stable task name. Routing is the
  coordinator's call, not the specifier's — see the coordinator note sent with
  this record.

## What happened

BL-714's implementation was built, reviewed and merged forward correctly for
three stages, then stopped being a parcel and became an anonymous ancestor of a
different ticket.

| commit | byline | stage under BL-714's name |
|---|---|---|
| `e48ae6222` | coder | merge `main` into coder for BL-714 |
| `33196b5af` | coder | D1 untrack vitest cache blob + D2 migrate 4 tests to `mkTmpDir` |
| `39012c6df` | coder | allowlist the new step-handler file in the facilitator residual scan |
| `fcc40a1e4` | cleaner | merge coder |
| `92a213127` | architect | merge coder |
| `80c8520a5` | hardender | **merge architect — last commit naming BL-714** |

At `80c8520a5` the hardener held BL-714's parcel. It never ran a BL-714
hardening pass and never forwarded BL-714. Instead it merged QA's BL-630 bounce
(`1e4567188`, "Merge QA 54cc44941c for BL-630 bounce #3") on top, did BL-630-only
hardening work (`b92688ede`), and sent **one** `git_handoff` under BL-630's task
name.

From that point BL-714's content travelled downstream as an unnamed ancestor:

```
32d36ad4d  documenter  merge hardener      (BL-630 name only)
7cb16ae83  QA          merge documenter    (BL-630 name only)
```

QA then bounced the combined parcel — documenter pass missing entirely
(`2903a32e6`) — and reverted its own review merge (`910d2a4e8`) per the
bounce-hygiene rule. That revert removed BL-714's content from the QA branch
along with BL-630's.

## State as of this record

Verified by `git merge-base --is-ancestor <c> main` for each BL-714 commit, and
by a full sweep of `.swarmforge/handoffs/*/inbox/{new,in_process}`:

- **None** of `33196b5af`, `39012c6df`, `fcc40a1e4`, `92a213127`, `80c8520a5`
  is an ancestor of `main`. The fix is not landed.
- The work survives on `swarmforge-QA`, `swarmforge-documenter`,
  `swarmforge-hardender` (and the coder/cleaner/architect branches below their
  own tips) — reachable, not lost.
- **No BL-714 parcel exists in any mailbox.** The only BL-714 trace in the
  handoff system is QA's note to the specifier. The ticket is not stalled
  mid-flight; it was dropped.
- `backlog/active/BL-714-*.yaml` still reads `assigned_to: coder`, which is
  stale — coder's pass is done.

## Which rule this breaks

Article 2.6, both halves:

> A `git_handoff` names ONE ticket in its `task` field. When … its committed work
> satisfies MORE THAN ONE ticket, it must forward EACH satisfied ticket as its
> own `git_handoff` under that ticket's own stable task name — never collapse
> several tickets under a single task name.

and

> A ticket whose work merged but whose ID never reached the coordinator note
> stays in `backlog/active/` forever.

BL-714 is the second half's exact shape, one stage earlier: its ID stopped
travelling at the hardener, so no downstream stage — and no coordinator
bookkeeping — could ever name it.

BL-506 ("An Approval Authorizes Only Its Ticket's Work") is the mirror view:
BL-630's parcel carried functional files that BL-630's ticket never authorized.
QA bouncing that parcel was correct on both counts.

## What BL-714 still owes

`required_stages: [coder, cleaner, architect, hardender, documenter, qa]`.
Passes actually run under BL-714's name: **coder, cleaner, architect**.
Outstanding: **hardender, documenter, QA**.

Resuming it means a `git_handoff` to hardender, task name
`BL-714-hardening-gates-blocked-by-tracked-vitest-cache-and-raw-mkdtemp`, on a
tip that has `92a213127` (the architect tip) as an ancestor. Note the entangled
ordering: BL-630's own rework tip also contains BL-714's content, so whichever
lands first carries the other's diff. Landing them under one approval is exactly
what QA refused — they need separating, and that separation is a routing
decision for the coordinator.

## Not recorded in bounce telemetry

Deliberately. This is not a bounce — no parcel was sent back — and
`record-bounce.js` has no representable shape for "a parcel that was never
forwarded at all". Logging it as a bounce would put a false event in the data.
Same tooling gap noted in the BL-714 `required_wiring` evidence file
(`29c378b4e`): the telemetry cannot see anything but role-to-role send-backs.

## Systemic follow-up

Nothing detects an absorbed parcel. The swarm had no signal between
`80c8520a5` (2026-07-30) and QA noticing by eye at review time; had QA passed
that parcel, BL-714 would have landed anonymously and sat in
`backlog/active/` indefinitely. Specced as a defect in `backlog/paused/`
(`human_approval: pending`) rather than fixed here.

Third instance of a ticket's identity being lost while its content travelled a
different path this week — the two prior ones went via the expedite path
(BL-657, BL-696), this one entirely in-pipeline.
