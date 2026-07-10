# Intake request (operator, 2026-07-10, via coordinator) — PRIORITIZE

## Phone-app drill-down into IMPLEMENTED features (implemented vs not, greyed out)

**Operator ask:** prioritize the phone app's drill-down into what has actually
been **implemented** so far. Show the not-yet-implemented items too, but **greyed
out** (still visible in the tree, visually de-emphasized), so the tree reads as
"here's what's shipped, and here's what's still to come."

**Priority:** operator wants this **prioritized** — spec it with a high priority
so the coordinator promotes it ahead of the current approved-but-unpromoted queue
(BL-246 / BL-251 / BL-252) as soon as a slot frees.

**Reuse — do NOT rebuild:** this is an ENHANCEMENT of the existing PWA docs
drill-down tree, not a new tree:
- **BL-117** (done) already renders the milestone → ticket → Gherkin drill-down in
  the phone app. Add an implementation-status dimension to it: implemented (done/)
  vs not-yet-implemented, with the unimplemented nodes greyed out.
- **BL-150** (done) already provides gherkin recertification sitting on that same
  tree — keep it working.
- Implementation status derives from existing state ("repo is the API"): a ticket's
  backlog folder (done/ = implemented; active/ + paused/ = not yet) and/or which
  Gherkin scenarios are live vs parked as `.feature.draft`. No new authoritative
  store.

**Open questions for the specifier to resolve with the operator if needed:**
- Granularity of "implemented": whole-ticket (done/) only, or per-Gherkin-scenario
  (live scenario = implemented, draft scenario = greyed)?
- Does greyed-out mean non-interactive (can't drill in / can't recertify), or just
  visually muted but still expandable?

_Turn this into a proper spec (prose description + Gherkin acceptance), place it in
backlog/paused/, and remove this intake file. Localize any new PWA strings via the
existing pwa/locales.js mechanism._
