# Brief: BL-1732 intake form's narrative sentence breaks into stacked dropdowns

**Artifact**: Telegram Intake form ("File an intake" Mini App page)
**Surface**: Telegram Mini App WebView, ~390px viewport, dark theme
**Reviewed**: 2026-09-30, source at `.worktrees/QA/tmp/bl1732-intake-form.html`
(QA sign-off request for BL-1732), cross-checked against
`extension/src/bridge/intakeFormUiHtml.ts`

## What's wrong, as a human sees it

The form's whole point (per the human's own words in BL-1732's source) is
one readable sentence:

```
As <a user>, I want to <do this action>, so I can <achieve this goal>.
```

rendered as `<div>As <select id="actor"></select>, I want to <select
id="action"></select>, so I can <select id="goal"></select>.</div>`.

The stylesheet's blanket rule:

```css
select, textarea, input[type="text"] { width: 100%; ... }
```

matches all three `<select>` elements, including these three inline ones.
Each becomes a full-width block, so at 390px the sentence does not read as
a sentence at all — it renders as "As" on its own line, a full-width
dropdown, ", I want to" on its own line, another full-width dropdown, "so
I can" on its own line, a third full-width dropdown, then a trailing ".".
The narrative — the one thing this ticket exists to make readable and
reusable — is the first thing a human sees, and it is illegible as
prose.

## Intended result

The three narrative dropdowns sit inline with their surrounding text, on
as few visual lines as the sentence naturally wraps to at 390px — never
one dropdown alone per line. Verify on the surface: reading the rendered
form at 390px, "As / I want to / so I can" reads as connected prose with
inline controls, the way the human's own sketch (`As a user / I want to
do this action / So i can acheive this goal`) reads as one narrative, not
three isolated form fields.

## Constraints

- The blanket `width: 100%` rule is right for the standalone form fields
  (scenarios/rule/notes textareas, and any full-row select outside the
  narrative). Scope the fix to the three narrative selects only — an
  `id` selector or a wrapping class, not a change to the shared rule.
- Selects still need enough width to show their longest seeded value
  (e.g. "a SwarmForge VC user (someone running the swarm on their own
  repo)") without truncating illegibly — `max-width` plus native select
  text overflow, not a fixed narrow width.
- No browser storage, no `<style>` in `<head>` restriction does not apply
  here (this is a Mini App page, not the briefing email) — inline
  `<style>` blocks are fine on this surface.

## Disposition

Blocking: this is the ticket's own central interaction rendering
illegibly, not a follow-up polish item. Routed to the specifier as a
`note` to mint against the same BL-1732 parcel's fix owner (QA's bounce
routes the actual fix; this brief is the acceptance for it).
