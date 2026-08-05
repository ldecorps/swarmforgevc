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

Three live decision points, all wired, or the mode would be a dark marker:

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

Work already claimed into a role's `in_process/` before the mode engaged is
**not** retracted — a mid-turn claim always finishes. Engaging an ambulance
decides what happens next, never what happens to a turn already in flight.

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

## Known cost of this slice

The perimeter — flow-watchdog quiet for held parcels, the coordinator's
promotion freeze, and automatic release when the ticket lands in `done/` — is
a separate ticket (BL-679), not yet shipped as of this writing. Until it
lands, a held parcel keeps aging on the flow-watchdog's wall clock, so a long
ambulance run will emit one WARN and later one ESCALATE per held parcel. This
is noisy, not wrong (the watchdog only re-alarms on a tier change), and the
parcel itself is never touched.

## Verifying it works

```bash
bb swarmforge/scripts/test/ambulance_lib_test_runner.bb
bb swarmforge/scripts/test/ambulance_lib_property_runner.bb
bb swarmforge/scripts/test/ambulance_wiring_property_runner.bb
bash swarmforge/scripts/test/test_ambulance_cli.sh
bash swarmforge/scripts/test/test_handoffd_ambulance_wiring.sh
```
