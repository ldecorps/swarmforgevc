# BL-1237 route refusal: the dispatch trail is a false positive (BL-1223)

Answering the coordinator's note `20260829T014516Z_003040`:
`BL-1237 route refused: dispatch-trail says DISPATCHED, no log evid.`

## Verdict: the refusal is wrong. Re-route with `--force`. Do NOT close.

## Reproduction

    $ bb swarmforge/scripts/dispatch_trail_cli.bb . dispatched BL-1237
    DISPATCHED

## What the trail is actually made of

Every handoff anywhere in `.swarmforge/handoffs/` that names BL-1237 — 15 of
them — was read and classified by its `type:` header:

| type | count | carries `task:` |
|---|---|---|
| `note` | 15 | 0 |
| `git_handoff` | 0 | — |

No parcel naming BL-1237 has ever existed. The trail is built entirely from
prose. The four contributing messages are the specifier's own, and each leads
with the ticket id because the 80-char `note` cap and house style both push
that way:

- `BL-1237 spec-ready: cleaner hard-blocked by ref-freshness guard, high`
- `BL-1237 expeditor CONFIRMED - use --no-restart. See NOTE-BL-1237-...md`
- `BL-1237 guard now refuses specifier ON main - remedy impossible, seat blocked`
- `BL-1237 active but unrouted; it blocks specifier+cleaner seats. Route to coder.`

The last one is the alarm about the gap. It is counted as evidence there is no
gap. `collect-dispatched-ticket-ids` (`swarmforge/scripts/chase_sweep_lib.bb`)
keeps a leading `BL-nnn` from a handoff's `task:` **or `message:`** header, and
a `note` only ever has `message:`.

Corroborating: the coder's mailbox holds one task, BL-1244, not BL-1237; and
`.swarmforge/board/ticket-stage-map.json` records no stage for it.

## Why "no log evid" was the right instinct

The coordinator's own phrasing already doubted the verdict. It should have.
`route_backlog_to_coder.sh:111` offers two exits — close it, or `--force`.
For this class of ticket the first is destructive: it would bury a
severity-high defect that was never built. Take `--force`.

## Root cause has a ticket, and that ticket had been destroyed

BL-1223 (`a note that merely names a ticket is counted as proof it was
dispatched`) is the owning fix. Restored to `backlog/paused/` in this commit —
see its own `notes:` for the destruction record. Its human approval had been
erased with it.

## Not fixed by this commit

BL-1237 is still unrouted, and the guard it describes still refuses the
specifier seat on `main`. The `--force` re-route is the coordinator's to run.
