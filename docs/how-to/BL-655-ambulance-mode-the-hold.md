# Ambulance mode — running one ticket exclusively while the swarm stays live

Use **ambulance mode** when one ticket is ultra-urgent but the pipeline itself
is healthy. It clears the road without stopping the city: every daemon, alarm
and Telegram topic keeps running, and only the designated ticket's parcels are
allowed to move. Every other parcel queues in place — untouched, byte-identical,
never delivered, dropped, quarantined, abandoned or rewritten — until released.

This is rung 2 of the escalation ladder:

| rung | mechanism | when |
|---|---|---|
| 1 | expedite lane (constitution Article 3.2.4) | a `critical`/`high` defect jumps the *promotion* queue, but still shares the live pipeline with everything else in transit |
| **2** | **ambulance (this guide)** | live pipeline, all daemons up, but only ONE ticket's parcels move |
| 3 | [the expeditor](BL-567-expedite-one-ticket-with-the-swarm-stopped.md) | the pipeline itself is the casualty — swarm stopped, ticket driven offline |

Reach for the expeditor only when the pipeline is broken. Reach for ambulance
mode when the pipeline is fine and one ticket just needs to go first.

## Engage, check, release

### From Telegram (the usual way in)

In the Control topic, alongside the existing pause verbs:

- `ambulance BL-654` — engages ambulance mode for that ticket. The bot refuses
  and reports back if the id names no ticket anywhere under `backlog/`.
- `ambulance off` — releases it. Every held parcel resumes moving on the next
  poll/dequeue/rotation decision — nothing needs restarting.

Both are confirmed back in the topic, naming the ticket. The Telegram bot is
one of the marker's two writers, matching how it already writes
`control-pause.json` — this is deliberate: the operator's own first need for
this mode was phone-bound at 01:15, and a CLI-only ambulance would be
unreachable at the moment it matters most.

### From the CLI

```bash
swarmforge/scripts/ambulance_cli.bb <project-root> engage BL-654
swarmforge/scripts/ambulance_cli.bb <project-root> status
swarmforge/scripts/ambulance_cli.bb <project-root> release
```

Each subcommand prints one JSON object and exits 0 on success. `engage`
refuses (exit 1) a syntactically invalid id, or a well-formed `BL-###` with no
YAML file anywhere under `backlog/` — engaging a ticket that does not exist
would hold everything forever, which is exactly the deadlock this mode is
built to avoid. `release` and a repeated `engage` of the same ticket are both
no-ops: the marker file is left byte-identical, not rewritten.

## What "held" means

A parcel is held when it positively names a **different** ticket than the one
under ambulance, and moves otherwise. Concretely, a parcel's attribution set
is every `BL-###` id in its `task:` header, `message:` header, and body:

- **Empty attribution moves.** A `note` with no ticket id at all (a real bounce
  or steering message sometimes carries none) is never held. This is
  deliberate fail-open: holding untagged notes would risk deadlocking the
  ambulance ticket itself the moment it gets bounced with no id in the message.
- **Naming the ambulance ticket moves**, even alongside other ids.
- **Naming only some other ticket is held** — left exactly where it sat, to be
  re-evaluated on the next poll once the mode changes.

The mode reads as **off** — identical to today's behavior — whenever the
marker file is absent, empty, unparseable, names no valid `BL-###` id, or
names a ticket with no backlog YAML anywhere. Every read site re-reads the
marker fresh at the moment of its own decision; no cached state survives a
change, so a release takes effect on the very next decision without
restarting anything.

## Where the hold applies

Four live decision points, all wired, or the mode would be a dark marker:

1. **Delivery** (`handoffd.bb`'s poll) — a held parcel simply is not delivered
   this poll; it stays in the sender's `outbox/` and is re-tried next poll.
2. **Dequeue** (`handoff_lib.bb`'s `resolve-dequeueable-candidates`) — a held
   parcel already sitting in `inbox/new/` when the mode engaged is not offered
   as a dequeue candidate; it stays in `new/`.
3. **Rotation actionability** (mono-router packs) — held mail is never
   actionable, so the resident is never pulled to it. This composes with
   [BL-576's aged-note rule](BL-576-aged-note-actionability-mono-router.md)
   rather than forking it: ambulance filters the candidate set first, aging
   still decides among whatever survives that filter.
4. **Chase sweep** (`chase_sweep_lib.bb`'s `sweep-role-inbox!`, BL-852) — a
   held parcel already sitting in `inbox/new/` draws no chase wake-up, no
   `.chase.json` write, no forced respawn, and no dead-letter; its on-disk
   footprint (parcel and sidecars) stays byte-identical across any number of
   sweeps. The counter is **frozen, not reset** — a hold can no longer
   inflate it, so on release the parcel resumes its ladder from the count it
   genuinely reached, and (mtime also untouched) is immediately past
   `chaseTimeoutSeconds` and draws a chase on the very next sweep. A held
   parcel already in `completed/`/`abandoned/` is still reaped, never held —
   provably-finished residue is not work being protected, and holding it
   would leave the ambulance guarding litter. Reuses the same
   `handoff-lib/default-ambulance-held?` predicate as the other three sites,
   never a second notion of held.

Work already claimed into a role's `in_process/` before the mode engaged is
**not** retracted — a mid-turn claim always finishes. Engaging an ambulance
decides what happens next, never what happens to a turn already in flight.
`sweep-in-process!` nudges are per-role, not per-parcel, and stay unaffected
by the hold — this is pre-existing dormancy behavior, not something the
ambulance changes.

## The marker

`.swarmforge/operator/control-ambulance.json`:

```json
{"active": true, "ticket": "BL-654", "engagedAtMs": 1753..., "by": "telegram"}
```

`{"active": false}` (or an absent file) means off. This mirrors
`control-pause.json`'s posture exactly — same fail-safe-to-off read pattern,
same idempotent writers — but it is a **separate** marker and predicate, never
folded into the pause gate.

## Explicitly unchanged

`active_backlog_max_depth`, the recommended-cap throttle, and
`effective_backlog_depth_cli.bb` all read exactly as before — ambulance is a
dispatch filter, not a depth change, so releasing it has no cap to restore and
cannot leave a throttle stuck on.

## Race safety (BL-813)

The fail-safe check inside `describe-status`/`read-ambulance-state` —
confirming the marker's named ticket still has a YAML file under
`backlog/` — globs the backlog tree and then reads each candidate. A ticket
that moves (e.g. `active/` → `done/`) between the glob listing it and the
read can vanish out from under that read; this no longer crashes the
daemon. Each candidate's read is independently guarded, so a vanished entry
is just skipped, and the predicate falls through to its existing degrade
path (`{:active false :reason "ticket ... has no YAML file under
backlog/"}`) exactly as if the ticket had never existed — never a thrown
exception. See BL-144's death-alarm doc for the incident this fixed.

## The perimeter (BL-679): quiet, frozen, self-releasing

BL-655 above delivers the hold itself. Three more pieces — shipped as
BL-679 — are what turn that hold into a mode a human would actually reach
for at 01:15, rather than one that alarms at them and has to be remembered
and released by hand.

### 1. Held parcels stop alarming

A parcel the ambulance holds is muted through the flow-watchdog's existing
snooze channel — the same channel a human's own snooze uses — rather than a
new branch on the tier decision. `decide-tier`'s input map stays exactly
the five keys it always accepted; the caller (`evaluate-parcel-tier`) is
what ORs the ambulance hold in alongside any pre-existing snooze. A long
ambulance run no longer emits a WARN or ESCALATE for every parcel the human
deliberately held.

**The ambulance ticket's own parcels are never muted.** They alarm exactly
as they do today — a stalled ambulance is the one thing the human most
needs to hear about.

### 2. The backlog stops filling behind the ride

While engaged, nothing is promoted from `backlog/paused/` into
`backlog/active/`:

- The daemon's own open-slot nudge (the "open slot + paused work -
  promote+route" wake) does not fire.
- The coordinator checks `ambulance_cli.bb status` before every promotion
  decision — intake, post-QA recheck, or a manual by-name promotion — and
  promotes nothing while the mode reads `"active": true`.

`active_backlog_max_depth` is untouched either way — the freeze is a
promotion gate, not a capacity throttle, so releasing it never has a cap to
restore.

**An expedited critical/high defect filed mid-ambulance queues like
everything else.** This is the one place the mode outranks Article 3.2.4,
deliberately: the human chose the ambulance knowingly, and only a human
lifts it. It does not go unmentioned, though — see the release
announcement below.

### 3. The mode releases itself when the patient leaves the pipeline

A sweep on the daemon's existing cadence (`ambulance-auto-exit-sweep!`, part
of the same loop as the flow-watchdog sweep) checks where the ambulance
ticket's YAML currently sits and reacts:

| ticket location | outcome | announcement |
|---|---|---|
| `backlog/done/` | release, case **delivered** | routine: the ride is over, every held parcel resumes moving |
| `backlog/hold/`, or vanished from `backlog/` entirely | release, case **abandoned** | 🚨 **loud** (ESCALATE-tier) — this is the deadlock case the operator ruled out: holding everything for a ticket nobody is working is worse than no mode |
| `backlog/active/` (or, defensively, `backlog/paused/`) | mode **holds** | nothing — a bounce is normal ambulance lineage, still in flight |

If a critical/high defect queued during the ride without ever being
promoted (piece 2 above), the release announcement names it **first**,
ahead of the release line itself, so it is not lost among everything else
that queued.

Exit is one-directional — nothing here, or anywhere else in the swarm, may
ever *engage* an ambulance. Every engage is still a human act.

## Verifying it works

```bash
bb swarmforge/scripts/test/ambulance_lib_test_runner.bb
bb swarmforge/scripts/test/ambulance_lib_property_runner.bb
bb swarmforge/scripts/test/ambulance_wiring_property_runner.bb
bb swarmforge/scripts/test/bl679_ambulance_perimeter_property_runner.bb
bb swarmforge/scripts/test/flow_watchdog_test_runner.bb
bb swarmforge/scripts/test/dispatch_gap_test_runner.bb
bash swarmforge/scripts/test/test_ambulance_cli.sh
bash swarmforge/scripts/test/test_chase_sweep.sh
bash swarmforge/scripts/test/test_handoffd_ambulance_wiring.sh
bash swarmforge/scripts/test/test_handoffd_chase_sweep_wiring.sh
bb swarmforge/scripts/test/bl852_chase_sweep_ambulance_hold_property_runner.bb
```

The perimeter's own acceptance scenarios live in
`specs/features/BL-679-ambulance-mode-perimeter.feature` (11/11 passing).
