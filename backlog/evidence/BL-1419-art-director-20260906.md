# Art Director review — BL-1419 — 2026-09-06

First act on taking the seat (BL-1417/BL-1418), per this ticket's own
`approval_context` deferring the look-and-feel review to the Art Director
once seated (see `backlog/evidence/BL-1419-qa-pass-20260905.md`).

## What I looked at

Rendered the real production path — `render-markdown-to-html` (body) then
`render-briefing-html` (phone-bounded wrapper) — against
`specs/pipeline/steps/fixtures/BL-1419-2026-09-05-briefing.md`, the same
real 2026-09-05 briefing QA used. Read the resulting HTML end to end as it
would lay out on a ~390px phone mail client viewport.

## Verdict

**Approved.** The reflow invariants the ticket promises hold on inspection:

- No wrapped-fragment paragraphs — an 8-line hard-wrapped blockquote in the
  source renders as one `<blockquote>`, wrapped list continuation lines
  join into single `<li>` elements.
- No `<style>` block; every element's spacing/type style is inline.
- Bounded single column (`max-width:640px`, `padding:16px`), system font
  stack, `line-height:1.5` — nothing forces horizontal scroll at phone
  width.
- Header names the artifact and the date before the first section.
- Diagrams (when present) render under their own heading, after the body,
  never interleaved.

## Follow-up (non-blocking)

One look-and-feel defect, not a reflow regression: list items under
multi-item themed groups (e.g. "Business features delivered", 15 items)
don't carry the bold weight their own group-intro sentence sets up, so a
ticket ID is hard to visually scan for on a phone. Filed as
[`docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md`](../../docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md).
Routed to the specifier via `note` (priority `00`) to mint.

Opened `docs/design/artifact-inventory.md` with the briefing email as its
first entry, and `docs/design/system.md` capturing the email rules this
render already establishes.

By art-director.
