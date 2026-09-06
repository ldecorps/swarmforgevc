# Design system

Cumulative, per-surface rules every human-facing artifact follows. A brief
adds a rule here the first time it needs one; a later brief that supersedes
a rule retires it instead of leaving two.

## Email (phone mail client)

Established by BL-1419 (reflow) and reviewed 2026-09-06 against the
2026-09-05 briefing render:

- **No `<style>` blocks.** Every element carries its style inline — mail
  clients strip `<head>` styles unpredictably.
- **Bounded single column**, `max-width:640px`, `padding:16px` on the
  outer wrapper — never a fixed `width` that forces horizontal scroll on a
  ~390px viewport.
- **System font stack**: `-apple-system,BlinkMacSystemFont,'Segoe UI',
  Roboto,Helvetica,Arial,sans-serif`. Body copy `line-height:1.5`,
  `color:#1a1a1a`.
- **Headings**: h2 18px/600, h3 16px/600, h4 15px/600 — size and weight
  only, no color, no rule/border. Text hierarchy first; ornament a mail
  client would drop is never added (Article "Design And Testability" /
  local Diagrams rule's spirit, applied to email).
- **Inline code**: monospace stack, `background:#f2f2f2`, small padding,
  `border-radius:3px` — used for identifiers, filenames, and shell
  fragments quoted inline.
- **Blockquote**: left border `#cccccc`, text `#555555` — used for
  attribution/methodology asides, not for emphasis.
- **List items needing to be scanned by a leading identifier (e.g. a
  ticket ID) bold that identifier token** — added 2026-09-06,
  [brief](briefs/2026-09-06-briefing-list-item-scan-weight.md). A list
  whose paragraph intro is bold but whose items are not creates an
  inconsistent scan path; the identifier a reader is hunting for should
  carry the same weight as the sentence that introduced the list.
