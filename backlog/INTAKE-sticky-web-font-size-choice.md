# INTAKE — Sticky font-size choice across the various web pages

**Source:** human via Cursor, 2026-08-26 ~09:45 BST  
**Surface:** phone / Mini App / dashboard web UIs that expose (or should
honour) a text-size control — at least Resident Spy Live Screen
(`residentSpyUiHtml.ts` / BL-609), Pipeline Board (`pipelineGridUiHtml.ts`),
Paused pager (`pausedPagerUiHtml.ts`), and the PWA dashboard (`pwa/app.js`
A-/A+). Bubble pages that later grow a size control should follow the same
contract.

Status: **new intake, not minted.** Specifier: mint and spec. Human wants
the **choice to stick** — reopen / reload / leave-and-return keeps the size
they picked.

## Why this is in front of you

Font size is adjustable on several surfaces, but persistence is inconsistent:

| Surface | Control today | Sticky? |
| --- | --- | --- |
| PWA dashboard | A-/A+ | Yes — purge-exempt `PREFERENCES_CACHE_NAME` Cache (not `localStorage`) |
| Pipeline Board | A-/A+ | Per-page `localStorage` key |
| Paused pager | A-/A+ | Per-page `localStorage` key |
| Live Screen (Resident Spy) | fullscreen +/- (BL-609) | **No** — session memory only; full Mini App reload resets to 13px **by design** in the BL-609 how-to |

Human ask (locked): **make the font size choice sticky** in the various
webpages. The Live Screen reset is the clearest gap; “various” means do not
stop at one page if siblings already forget or diverge.

## Goal

1. A human who picks a readable size once should still see that size after
   reload, closing the Mini App, or switching away and back.
2. Behaviour is **consistent across the webpages that offer a size control**
   — same sticky contract (and preferably one shared preference where that
   is honest), not a different reset story per page.
3. Respect Architecture Rule 3 / existing house preference pattern: PWA
   already avoided bare `localStorage` via Cache API; BL-609 explicitly
   refused browser storage. Specifier must pick a persistence shape that is
   house-legal (e.g. Cache API like the dashboard, bridge-hosted preference
   JSON, or another approved seam) — **do not** silently contradict Rule 3
   with a new `localStorage` only on Live Screen without a written
   disposition.

## Preferred shape (specifier may refine)

1. **Persist** the Live Screen pane font-size across reloads (undo the
   BL-609 “reset on reload” operator note).
2. **Align** Pipeline / Paused / PWA (and any other A-/A+ Mini App pages)
   on one sticky policy: either one shared “web UI text size” preference, or
   documented per-surface keys that all survive reload the same way.
3. Clamp / step ranges may stay surface-specific if needed (Live Screen
   9–20px vs dashboard 16–40px) — stickiness is the ask, not one numeric
   range for every page.
4. Missing / corrupt stored value → existing defaults (13px Live Screen,
   28px dashboard, etc.).

## Out of scope

- Redesigning typography / layout of every page.
- Forcing Bubble native chrome to use the same control if it has none yet
  (when Bubble gains a size control, inherit this sticky contract).
- Changing locale or other preferences.

## Related

- BL-609 — Resident Spy pane font-size control (explicitly non-sticky)
- BL-220 / BL-249 — PWA font-size + preferences Cache
- `extension/src/bridge/residentSpyUiHtml.ts`,
  `residentSpyPaneFontSize.ts`
- `extension/src/bridge/pipelineGridUiHtml.ts`,
  `pausedPagerUiHtml.ts`
- `pwa/app.js` `FONT_SIZE_PREF_KEY` / `PREFERENCES_CACHE_NAME`
- `docs/how-to/BL-609-resident-spy-font-size-control.md`

## Acceptance sketch

- Feature: after setting Live Screen +/- and fully reloading the Mini App,
  pane text returns at the chosen size (within clamp), not the default.
- Feature: Pipeline Board and Paused pager still restore their size after
  reload (no regression); if unified, one change applies where specified.
- Feature: PWA A-/A+ sticky behaviour unchanged or improved, not regressed.
- Feature: persistence mechanism is named and Rule-3-compatible (or an
  explicit human/specifier waiver is recorded).
- Property/unit: round-trip store → load → clamp for the Live Screen (and
  any new shared pref helper).
