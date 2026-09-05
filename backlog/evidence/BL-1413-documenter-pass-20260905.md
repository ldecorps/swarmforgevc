# Documenter evidence — BL-1413

## Ticket
BL-1413-the-freshness-check-reads-past-a-nul-byte

## Hardener tip
0544df0bc2

## Review inventory (Article 4.4)
NONE.

## Docs impact
- `docs/how-to/BL-675-daemon-log-freshness-watchdog.md` (existing owning
  page, extended in place): new "Reading past a NUL byte (BL-1413)"
  section (grep -a text-mode read, newest-to-oldest parseable-timestamp
  fallback, unparseable-timestamp sentinel only when no line parses);
  feature/property-runner/fixture references added near the existing
  acceptance-feature list.
- `docs/reference/Specification.MD`: new Last-Updated changelog entry.

## Diagram
No edit. No diagram depicts this script's internal shell-level read
behavior — the same granularity call BL-1392's own Specification.MD entry
made for this same script's cron-heartbeat sweep.

## Acceptance cross-check
Aligned with
`specs/features/BL-1413-the-freshness-check-reads-past-a-nul-byte.feature`.

By documenter.
