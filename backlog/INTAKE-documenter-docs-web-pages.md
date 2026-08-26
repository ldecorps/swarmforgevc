# INTAKE — Think about a series of web pages to render the docs the documenter has been writing

**Source:** human via Cursor, 2026-08-26 ~23:41 BST  
**Status:** new intake, not minted. Specifier: think, then mint/spec as appropriate.  
**Direction hint:** likely `human-requested` if minted — Bubble ramp over new
Telegram/PWA UX (see `backlog/STEERING.md` standing freeze), but this is
explicitly about making the **documenter corpus** readable on the phone.

## Human ask (locked)

> Think about a series of web pages to render the docs the documenter has been
> writing.

Capture only. The human is asking for **design thinking**, not a pre-cut
implementation plan.

## Problem

The swarm's documenter role has been landing a large, growing authored corpus
under `docs/` — how-to guides, reference pages, tutorials, explanations —
indexed by `docs/index.md` (Divio modes). A human on the phone cannot
comfortably read that corpus today:

- **Pages PWA** (`pwa/`) exposes a docs explorer, but it renders
  `docs-tree.json` — vision → milestone → ticket → Gherkin — not the
  documenter's markdown how-to/reference pages.
- **Bubble** has remote HTML pages for operator screens (Live, Pipeline,
  Health, …) but no docs browser yet.
- **Telegram Mini App** is maintain-only for new UX; do not grow it as the
  docs home.

Orphan hygiene is a separate concern (e.g. BL-756 — docs landed without
`docs/index.md` links). This intake is about **rendering and navigation**, not
the index-exhaustiveness gate itself — though the two may meet in spec.

## What exists today (verified pointers — specifier re-check at mint time)

| Artifact | What it covers |
| --- | --- |
| `docs/index.md` | Exhaustive index of authored docs by Divio mode |
| `docs/how-to/`, `docs/reference/`, `docs/tutorials/`, `docs/explanation/` | Documenter-authored markdown corpus |
| `extension/src/docs/docsTree.ts` | Builds ticket/Gherkin drill-down tree for PWA |
| `pwa/app.js` | Renders `docs-tree.json` (spec acceptance browser) |
| `extension/src/docs/docsStructure.ts` | Orphan checker / structure helpers (BL-456) |
| BL-824 / BL-829 | Bubble thin shell + remote page pager (pattern for bridge-hosted pages) |

## Goal (for specifier to refine)

1. **Propose** a coherent family of web pages that let the operator browse and
   read the documenter corpus on the phone — starting from `docs/index.md`
   structure (tutorials / how-to / reference / explanation), not from the
   Gherkin tree alone.
2. **Decide surface placement:** Bubble remote HTML page(s) in the UI bundle
   (preferred per STEERING ramp), bridge-served read-only pages, an extension
   of the PWA artifact pipeline, or a staged combination — with explicit
   reasoning.
3. **Decide rendering shape:** static pre-render at deploy time vs on-demand
   markdown→HTML at the bridge vs packaged HTML in the bundle — respecting
   Architecture Rule 5 (static backlog-dashboard PWA vs live holistic UI) and
   existing remote-HTML patterns from Bubble screen tickets.
4. **Offline / sync:** honest v1 posture — what works offline on Bubble
   (compare `backlog/hold/INTAKE-phone-wire-format-and-offline.md` if
   relevant), what requires bridge auth, what can piggyback on artifacts the
   app already syncs (`backlog.json`, `docs-tree.json`, companion manifest).
5. **Search and navigation:** at minimum index → section → page; specifier
   may propose search, deep links from ticket ids (`BL-###` in how-to
   filenames), and cross-links back to the spec/Gherkin tree where useful.
6. **Scope boundary:** read-only docs browser — not editing, not minting
   tickets, not replacing `docs/index.md` as source of truth in git.

## Non-goals (unless human amends)

- Rewriting or reorganising the Divio doc set.
- Replacing the PWA Gherkin/spec explorer (may coexist).
- New Telegram Mini App pages for docs.
- Fixing every pre-existing orphan in one slice (may reference BL-756).

## Open questions for specifier (defaults allowed — ask if unsure)

1. **One page or many?** Single scrollable index with client-side drill-down
   vs one remote HTML page per Divio mode vs one page per doc — trade phone
   UX against bundle size and refresh cost.
2. **Relationship to `docs-tree.json`:** separate "Operator docs" section in
   Bubble vs unified browser with two top-level tabs (Specs / Authored docs).
3. **Auth:** public static projection vs bridge token (Live Screen class) vs
   Bubble principal — which corpus paths need which gate.
4. **Mint shape:** one epic + slices (index page, how-to section, reference
   section, search) vs one ticket if the specifier judges the work small
   enough.

## Acceptance shape to refine (placeholder)

1) From Bubble (or named v1 surface), open a docs entry point and reach
   `docs/index.md`'s four Divio sections without a laptop.  
2) Open at least one how-to and one reference page authored by the
   documenter; rendered markdown is readable on a phone viewport.  
3) Deep link or search by `BL-###` finds the matching how-to when one exists.  
4) Read-only: no write path to git or backlog from the browser.  
5) How-to for operators when shipped; orphan index links remain the
   documenter's mint-time obligation unless a separate ticket says otherwise.

## Related / do not duplicate blindly

- BL-756 — orphan docs not linked from `docs/index.md` (hygiene, not browser)
- BL-824 / BL-829 — Bubble shell + pager (likely dependency if Bubble-hosted)
- `backlog/hold/INTAKE-phone-wire-format-and-offline.md` — offline wire format
- BL-711 — interface vs incarnation naming (Bubble not "Float Companion")
