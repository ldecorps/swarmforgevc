# Intake request (operator, 2026-07-10, via QA)

## PWA "French rendering" silently shows English when translation failed/was unavailable — no indicator

**Operator report:** on the phone PWA's docs drill-down, tapping "Show French
rendering" on a Gherkin scenario reveals a second block that is word-for-word
identical to the English block above it — no visible sign anything is wrong.
(Screenshot: docs drill-down for a handoff-broadcast scenario, "Hide French
rendering" toggled, both blocks showing the same English text.)

**Root cause (QA investigation):**
- `extension/src/i18n/translate.ts`'s `translateString()` degrades on ANY MT
  engine failure (missing `MT_API_KEY`, a real API error, etc.) by design —
  bilingual-05's rule is that a translation failure must never block
  publishing. It returns `{ text: <original English>, untranslated: true }`
  rather than throwing.
- `docsTree.ts`'s `translateScenario`/`translateTicket`/`translateVisionDoc`
  correctly propagate that as `textFrUntranslated` / `titleFrUntranslated` /
  `descriptionFrUntranslated` / `contentFrUntranslated` on the published
  `docs-tree.json` — the signal genuinely exists in the data.
- `pwa/app.js` never reads any of these four `*Untranslated` flags (grep-
  confirmed, zero references). Every French-rendering surface — ticket
  titles (`ticketTitle`), descriptions (`renderDocsTicket`), vision docs
  (`renderDocsVision`), and the Gherkin scenario reveal
  (`renderDocsScenario`) — renders `titleFr`/`descriptionFr`/`contentFr`/
  `textFr` unconditionally whenever the field is truthy, with no check for
  whether it is a REAL translation or a same-text fallback.
- No test anywhere in the suite exercises the untranslated case against the
  PWA rendering layer (checked `pwaLocale.test.js`, `pwaDocsExplorer.test.js`)
  — only the host-side `translate.ts`/`docsTree.ts` unit tests cover the flag
  itself. This has been latent since the original bilingual work (BL-118/
  BL-230); every later PWA-touching ticket this session (BL-249, BL-253,
  BL-254) reused the existing rendering helpers without exercising this path.

**Wanted (specifier to shape into acceptance):**
1. Every surface that reads a `*Fr`/`*textFr` field must also check its
   paired `*Untranslated` flag, and when true, render a clear "machine
   translation unavailable" indicator instead of (or alongside) presenting
   the fallback text as if it were French — never silently pass English off
   as a translation.
2. Cover all four surfaces (ticket title, description, vision doc content,
   Gherkin scenario reveal) — this is systemic, not scenario-reveal-only.
3. Add PWA-layer test coverage (jsdom, `pwaDocsExplorer.test.js`/
   `pwaLocale.test.js` precedent) that fixtures an `*Untranslated: true`
   entry and asserts the indicator renders — closing the exact gap that let
   this ship unnoticed.

**Constraints / fit:**
- REUSE: the `*Untranslated` flags already exist and are already correctly
  computed/published — this is a PWA rendering-layer fix only, not a
  translate.ts/docsTree.ts change.
- LOCALIZATION: any new indicator string goes through `pwa/locales.js`, same
  as every other PWA string (BL-229/BL-230 convention).
- Low priority relative to a live outage, but real user-facing confusion
  (French readers cannot tell a real translation from a silent fallback) —
  operator to set priority.

_Specifier: turn into a spec (prose + Gherkin acceptance), place in
backlog/paused/, remove this intake file._
