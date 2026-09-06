# Art Director — Design System

Kept by the Art Director (Article 1.10). Records which visual/design
assets are **ruled** (an actual decision the swarm builds to) versus
still **unruled** (exploration, or not yet decided). Seeded at mint
(BL-1440) with the one asset that already existed; the Art Director keeps
this current from its first pass onward.

## Ruled

- **Icon system** — `docs/branding/icon-system.md` (BL-945). The
  "orchestra" metaphor: an agent is a player, a swarm is a conductor +
  ensemble, a fleet is an orchestra of ensembles. Palette-per-role
  section-arc mark for the podium/fleet views. **Status note:** that
  document's own header still reads "design exploration / not yet
  ratified" as of this writing — a follow-up pass should confirm whether
  it has since been ratified in practice (icons already shipped and in
  use, per `extension/src/concierge/topicIcon.ts` and
  `extension/src/concierge/epicIcon.ts`) and update that header
  accordingly, or record here that it remains exploratory.

- **Daily briefing email** (BL-1419, reviewed 2026-09-06) — phone mail
  client rules:
  - **No `<style>` blocks.** Every element carries its style inline —
    mail clients strip `<head>` styles unpredictably.
  - **Bounded single column**, `max-width:640px`, `padding:16px` on the
    outer wrapper — never a fixed `width` that forces horizontal scroll
    on a ~390px viewport.
  - **System font stack**: `-apple-system,BlinkMacSystemFont,'Segoe UI',
    Roboto,Helvetica,Arial,sans-serif`. Body copy `line-height:1.5`,
    `color:#1a1a1a`.
  - **Headings**: h2 18px/600, h3 16px/600, h4 15px/600 — size and weight
    only, no color, no rule/border. Text hierarchy first; ornament a mail
    client would drop is never added.
  - **Inline code**: monospace stack, `background:#f2f2f2`, small
    padding, `border-radius:3px` — used for identifiers, filenames, and
    shell fragments quoted inline.
  - **Blockquote**: left border `#cccccc`, text `#555555` — used for
    attribution/methodology asides, not for emphasis.
  - **List items needing to be scanned by a leading identifier (e.g. a
    ticket ID) bold that identifier token** — added 2026-09-06,
    [brief](briefs/2026-09-06-briefing-list-item-scan-weight.md), minted
    as BL-1442. A list whose paragraph intro is bold but whose items are
    not creates an inconsistent scan path; the identifier a reader is
    hunting for should carry the same weight as the sentence that
    introduced the list.

## Unruled — for the Art Director to fill

- **Telegram message** visual conventions (pipeline board captions, alert
  formatting, approval-ask layout) beyond the icon marks above.
- **Static PWA** visual design (currently function-first, generated
  directly from `backlog.json`).
- **Live console / Mini App** visual design.
- **Rendered docs** typography/structure conventions beyond Markdown
  defaults.
- A general voice/tone guide for swarm-authored human-facing text
  (briefing prose, Telegram copy, doc prose) — distinct from the
  engineering-prose conventions in `swarmforge/constitution/`, which
  govern internal ticket/commit text, not what a human reader sees.

## How this file is used

- A design brief (Article 1.10: "writes design briefs; the specifier
  mints from them") should say which of the above it rules on, and this
  file's own "Unruled" list should move that item to "Ruled" once the
  brief lands and the specifier mints the implementing ticket.
- QA's sign-off note on an artifact parcel (Article 1.10: "answers QA's
  sign-off `note` ... with `LGTM` or a defect list") should check the
  parcel against whatever this file already rules for that artifact.
