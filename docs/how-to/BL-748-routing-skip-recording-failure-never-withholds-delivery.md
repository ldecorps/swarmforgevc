# Routing-skip journal failure never withholds delivery (BL-748)

## The gap

`swarm_handoff.bb`'s `-main` binds, in one ordered `let`: durable outbox write,
then `log-routing-skip!`, then `try-sync-deliver!`, then draft delete.

`log-routing-skip!` used to append `.swarmforge/routing-skips.jsonl` with no
try/catch. Any I/O failure (unwritable parent, unwritable file, full disk)
aborted the whole `let`: the real-time wake never ran, the draft leaked, and
the process died on an uncaught exception — even though the parcel was already
in the outbox. That contradicted BL-623's own "record-write failure must not
block the send" guardrail.

## The fix

`log-routing-skip!` now matches `try-sync-deliver!`: catch, report on stderr
via shared `report-nonfatal!`, return `:failed`, and let `-main` continue.
Recording stays observational; the guard is scoped to the journal call (not a
blanket catch around delivery).

| Symptom | Meaning |
| --- | --- |
| `ROUTING-SKIP RECORD FAILED: …` on stderr | Journal I/O failed; parcel still delivered / queued; draft consumed |
| No such line on a skipping hop | Journal wrote normally |
| Adjacent hop (nothing to record) with unwritable journal | Delivers; no recording-failure line |

## Operator note

If you see `ROUTING-SKIP RECORD FAILED`, fix disk permissions on
`.swarmforge/` / `routing-skips.jsonl`. The recipient should already have been
woken (or the daemon mailbox path still holds the parcel). Do not re-send
solely because the journal failed.

Acceptance:
`specs/features/BL-748-routing-skip-recording-failure-never-withholds-delivery.feature`

Related: `docs/how-to/BL-623-routing-skip-trail-records-actual-hop.md`.
