# Art Director — Design System

Kept by the Art Director (Article 1.10). Records which visual/design
assets are **ruled** (an actual decision the swarm builds to) versus
still **unruled** (exploration, or not yet decided). Seeded at mint
(BL-1440) with the one asset that already exists; the Art Director keeps
this current from its first pass onward.

## Ruled

- **Icon system** — `docs/branding/icon-system.md` (BL-945). The
  "orchestra" metaphor: an agent is a player, a swarm is a conductor +
  ensemble, a fleet is an orchestra of ensembles. Palette-per-role
  section-arc mark for the podium/fleet views. **Status note:** that
  document's own header still reads "design exploration / not yet
  ratified" as of this writing — the Art Director's first pass should
  confirm whether it has since been ratified in practice (icons already
  shipped and in use, per `extension/src/concierge/topicIcon.ts` and
  `extension/src/concierge/epicIcon.ts`) and update that header
  accordingly, or record here that it remains exploratory.

## Unruled — for the Art Director to fill

- **Daily briefing email** layout/typography (BL-1419, in flight under
  epic BL-1417).
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
