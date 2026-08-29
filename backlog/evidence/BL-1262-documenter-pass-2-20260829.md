# BL-1262 Documenter Pass (2, post-QA/architect bounce) — 2026-08-29

## Commit under review
Hardener tip `75cfb3ffb` (merged into swarmforge-documenter as `3ca50c753`).

## What changed since the first documenter pass (`9cbd5b280e`)
QA bounced on two defects (incomplete restoration + over-strict acceptance
step); the coder's fix attempt added integration points to
`front_desk_supervisor.bb` / `handoffd.bb`, which the architect bounced as
out-of-scope; the cleaner reverted those, architect re-approved, hardener
added coverage. Net effect on the four named files: unchanged from the
first documenter pass — same 67/107/50/47-line restoration, verbatim
against `8562094f8`.

## Re-verified

- The four restored files are present and match the state reviewed in the
  first pass; no further doc-relevant change occurred.
- `docs/how-to/BL-597-trend-self-heal-events.md` and
  `docs/reference/Specification.MD` still describe the module paths and
  function names correctly for the restored TypeScript/Babashka pieces.

## Defect found this pass, NOT owned by this ticket

`docs/how-to/BL-597-trend-self-heal-events.md` lines 24-31 state each event
type is "appended at the same site that already logs the prose line" and
names `stale-build-recompile` (front-desk supervisor), `supervisor-respawn`,
and `claim-heal` (handoffd) as emitted types. Confirmed by grep that
`swarmforge/scripts/front_desk_supervisor.bb` and
`swarmforge/scripts/handoffd.bb` contain NO `append-self-heal-event!` call
sites and no `self_heal_telemetry_lib.bb` load — this matches what the QA
bounce (D1) and both architect passes already found and ruled out of
BL-1262's scope (the four named files only). The doc's claim about those
two hosts is therefore currently false against the tree, and no ticket
covers restoring the missing call sites.

Per Article 3.6 / documenter role rules, docs must not be reworded to hide
retired/missing behavior, and BL-1262's own constraints forbid touching
those two files or the docs in this ticket. Filed as a `note` (priority
`00`) to specifier and coordinator rather than a doc edit or a second
bounce: see handoff
`.swarmforge/handoffs/outbox/00_20260829T123449Z_000946_from_documenter_to_specifier_coordinator.handoff`.

## Conclusion

No documentation edit made in this parcel — the docs are correct for what
BL-1262 restores; the separate gap (missing emit call sites in
front_desk_supervisor.bb/handoffd.bb) is out of this ticket's scope and has
been raised as a spec-gap note, not folded into this handoff.

Forwarding to QA.

By documenter.
