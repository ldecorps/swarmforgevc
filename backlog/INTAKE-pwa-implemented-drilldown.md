# Intake request (operator, 2026-07-10, via coordinator) — PRIORITIZE

## Phone-app drill-down into IMPLEMENTED features (implemented vs not, greyed out)

**Operator ask:** prioritize the phone app's drill-down into what has actually
been **implemented** so far. Show the not-yet-implemented items too, but **greyed
out** (still visible in the tree, visually de-emphasized), so the tree reads as
"here's what's shipped, and here's what's still to come."

**SEARCH / FILTER THE SPEC (operator clarification — this is the core need):**
The operator needs **a way to search the spec** from the phone app — a text
search/filter box that **matches any Gherkin scenario** (and ideally ticket
title/description) by its text. Typing a query filters the drill-down tree to the
items whose Gherkin scenarios contain that text, across BOTH implemented and
not-yet-implemented items. Matched results keep their implementation-status
styling (greyed if not yet implemented). Example: type a phrase and see every
scenario/ticket mentioning it. This full-text spec search is the primary ask;
the implemented-vs-greyed drill-down is the surface it filters over.

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
