# Deprecated Pages

The home for documentation whose described behaviour has been retired.
Article 1.7 (Documenter) moves a page here in the same commit that retires
the behaviour it describes, and the specifier's Article 3.6 deprecator
freshness gate is what decides a behaviour is stale enough to retire
(`/deprecate confirm`, per BL-1174). A page never moves here on its own -
retirement is a deliberate, human- or specifier-adjudicated call, not a
housekeeping sweep.

A retired page is never deleted and never silently rewritten in place:
moving it preserves the record of what the swarm used to do and why, for
anyone later asking "didn't this used to work differently?". The page
itself keeps its own content; only its location and, ideally, a short
retirement note at its top change.

## Retired pages

| Page | Retired by | Reason |
|------|-----------|--------|
| [BL-1641: the closing ceremony composes a headless briefing at its hard deadline](BL-1641-closing-ceremony-headless-composer.md) | BL-1836 (2026-10-02) | Human ruling (2026-09-30): the ceremony waits for the documenter's own briefing instead of substituting a headless dump; a missing briefing at the deadline now just stops the swarm loudly, as it did before BL-1641. |
| [Milestone 1's manual HANDOFF.md handoff note](HANDOFF-milestone-1.md) | BL-2050 (2026-10-07) | The root `HANDOFF.md` was a manual pre-mailbox handoff note (2026-06-29); on 2026-10-06 a seat rewrote it instead of forwarding two finished QA bounces, hiding both fixes from the pipeline. Handoffs now travel only through `swarm_handoff.sh` and the mailbox. |
