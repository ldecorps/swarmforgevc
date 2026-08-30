# BL-670 — the board's stage carries a qualifier, an as-of, and a health dot

Coder, 2026-08-30. Semantics plus the health dot; every layout concern is
BL-585's, per the human's 2026-08-19 ruling.

## What changed, in four places and two languages

| site | change |
|---|---|
| `pipeline_stage_lib.bb` | the three status literals, `reconcile-stage-entries`, `health-dot-for-bounces` |
| `pipeline_stage_cli.bb` | scans `:sent` alongside `:new`/`:in_process`; derives status + as-of + dot |
| `swarmState.ts` | `TicketStageEntry`, mirrored literals, a normalising reader |
| `pipelineGridLive.ts` (via `invertTicketStageToRoleHeldTickets`) | takes either shape |

`.swarmforge/board/ticket-stage-map.json` now reads, against the live swarm:

```json
{"BL-604":{"stage":"hardender","status":"claimed","asOf":"2026-08-30T02:54:21Z","healthDot":"green"},
 "BL-1232":{"stage":"hardender","status":"in-transit-to","asOf":"...","healthDot":"green"},
 "BL-1194":{"stage":"coordinator","status":"last-known","asOf":"2026-08-27T18:05:20Z","healthDot":"green"},
 "BL-1182":{"stage":"QA","status":"claimed","asOf":"...","healthDot":"yellow"}}
```

BL-1182 reading `yellow` is its one recorded bounce, from its own
`bounce_history:` — no new store, as the ticket verified at mint.

## The design decision a scenario made for me

The obvious reading is to rank the three statuses against each other: claimed
beats in-transit beats last-known. It broke a landed contract on its first run.
BL-1048's own scenario has a ticket delivered to the architect while still open
at the cleaner and requires the LATER role to win, because more-downstream is
more current. Status precedence made the upstream claim win, and BL-1048 went
5/6.

So **the trail is a fallback, not a competitor**: live observations reconcile
exactly as they did — role order, most-downstream wins, BL-464 and BL-1048
untouched — and `sent/` is consulted only for tickets no live box mentions at
all. That is also the honest reading of what a trail is: evidence about where a
ticket WAS can never beat evidence about where it IS. It has the useful side
effect that a stale trail entry cannot displace a live derivation, which matters
most under a bounce, where the trail's newest downstream entry is the stalest
thing about the ticket.

## A second ordering defect, found by my own property test

`P2: reconciliation is order-independent` failed on 71 of 500 draws. Two
observations at the SAME role with the SAME status differ only in their as-of,
and whichever the directory listing yielded first was kept — so the as-of the
board showed depended on filesystem order.

`displaces?` now has an explicit third tier: same role, same status, the LATER
as-of wins. ISO-8601 UTC instants compare correctly as strings, which is why it
is a string compare and not a parse.

## `sent/` names the recipient, not the sender

A parcel in a role's own inbox names that role. A parcel in its SENT box names
the role it was sent TO — the trail records where the ticket went. Reading the
mailbox owner there would park every forwarded ticket back on whoever last
touched it, which is the opposite of last-known.

## Both shapes are read, deliberately

`readTicketStageMap` and `invertTicketStageToRoleHeldTickets` still accept a
bare role string. Several landed acceptance fixtures write the pre-BL-670 shape
directly (BL-464, BL-487, BL-1188), and a swarm whose cache predates the
qualifier must not render a blank board. A bare role reports as `last-known` —
the honest reading of "we know where it was and nothing more".

## The mirrored constants are tested, not commented

Six literals cross the language boundary (three statuses, three dot colours).
`bl670TicketStageQualifier.test.js` reads them out of `pipeline_stage_lib.bb`'s
source and asserts the TypeScript constants equal them — the engineering
article's mirrored-constant rule, BL-897.

## The invariants (BL-654)

Invariant 1 is about the DERIVATION, so its property lives in the Babashka lane
beside it (`bl670_stage_qualifier_property_runner.bb`); invariants 2 and 3 are
about the readers and live in `bl670StageQualifierInvariants.property.test.js`.

Reach is constructed: the bb generator uses a **three-role, two-ticket**
alphabet so the same ticket is observed at two roles constantly — the collision
the reconciler exists for — rather than once in a blue moon, with floors on all
three statuses, on multi-observation draws and on collisions (measured: 551 /
509 / 476 / 417 / 349). The JS generator draws the entry SHAPE per entry, not
per file, because a real store mid-upgrade is mixed and a per-file draw would
never produce one.

**Non-vacuity, all three by breaking the code and running:**

| break | result |
|---|---|
| the derivation drops the as-of | P1 FAILS: "an entry carries no as-of time" |
| a trail entry may displace a live one | P3 FAILS: "has a live observation but derived last-known" |
| the reader memoises the cache | invariant 3 FAILS: "the reader handed back the same object twice" |

Restored; all green.

## Runs

| what | result |
|---|---|
| BL-670 acceptance | **9/9** |
| `bl670_stage_qualifier_property_runner.bb` | ALL PASS, 500 runs each |
| `bl670StageQualifierInvariants.property.test.js` | 3/3 |
| `bl670TicketStageQualifier.test.js` (incl. mirrored constants) | 21/21 |
| `pipeline_stage_qualifier_test_runner.bb` (new) | ALL PASS |
| `pipeline_stage_lib_test_runner.bb` (pre-existing) | ALL TESTS PASSED |
| `test_pipeline_stage_cli.sh` | ALL CHECKS PASSED |
| BL-1048 / BL-464 / BL-487 / BL-1188 acceptance | 6/6, 5/5, 2/2, 5/5 |
| suite inventory | ok — 437 files, the new runner registered |

`test_pipeline_stage_cli.sh`'s assertions moved from the bare-role JSON to the
entry's `stage` field. They match a PREFIX, so a later ticket adding a field to
the entry does not have to touch that file again; the one exact-equality check
became "one entry, and it is the opened one", counting entries rather than
matching the whole string.

## Out of scope, untouched

Sync triggers (BL-487 shipped that and the ticket says not to re-litigate it),
all layout including the dropped mini-slug (BL-585), the per-ticket legend
deep-links (BL-940), and the not-started defect itself (BL-1048 shipped it and
its feature file owns it). Painting the health dot on the rendered board is
layout and therefore BL-585's; this parcel derives it and carries it in the one
map both consumers read, so it is data with a live reader rather than a dark
field.

## One thing my own parcel got wrong, caught by the guard next door

BL-1280's standing property test refused the first commit: both new BL-670 test
files allocated their fixture roots with a raw
`fs.mkdtempSync(path.join(os.tmpdir(), ...))`, the exact call BL-1280 banned
from `extension/test/` two parcels earlier. Migrated to `mkTmpDir`, which is
the correct variant here — every allocation is inside a test body or a helper
called from one, so the per-test afterEach sweep is the right lifetime.

Worth recording because the guard did its job on its author: the ban is four
hours old and I still reached for the old call out of habit.
