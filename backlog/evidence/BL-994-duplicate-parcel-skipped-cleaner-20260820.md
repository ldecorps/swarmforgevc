# BL-994 duplicate-parcel notice — 2026-08-20 (cleaner)

## What happened

Two independent coder fixes exist for the same hardener D1/D2 bounce
(`backlog/evidence/BL-994-live-screen-role-tiles-are-a-square-ish-grid-bounce-20260820.md`):

1. `080b30253` — sent `coder -> cleaner -> architect` (this session, priority
   00, task `BL-994-live-screen-role-tiles-are-a-square-ish-grid`), the
   route `required_stages: [coder, cleaner, architect, hardender,
   documenter, qa]` declares. Merged into the cleaner branch, fully
   verified: `npm run compile` clean; BL-929 feature 4/4 PASS; BL-994's own
   feature 8/8 PASS; `residentSpyUiHtml.test.js` (4/4) and
   `bl994LiveScreenGrid.test.js` (8/8) PASS; grep confirms no lingering
   reference to the retired step text or the now-unused
   `documenterPaneHeadHtml` field. Cleaner tip: `00e185819`.
2. `3d83c16171` — sent `coder -> architect` DIRECTLY. The delivered
   handoff's own header records `routing_skipped: BL-994 coder->architect
   skipped=cleaner` and `dequeued_at: 2026-08-20T21:14:54Z` — architect has
   already claimed it. This send skipped a stage the ticket's own
   `required_stages` explicitly declares; not authorized by anything in
   the ticket.

Sending my own properly-routed parcel now fails: `swarm_handoff.sh`
refuses with "a live parcel for this ticket already exists at architect"
(commit `3d83c16171`).

## Why this matters, not just a duplicate-send cleanup

The two implementations diverge in a way that is NOT cosmetic.
`3d83c16171`'s `renderLiveScreenAndExpand` closes its jsdom window with a
**bare, unguarded call at the end of the function** on the success path:

```js
col.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush();
const result = { ... };
dom.window.close();   // unreached if anything above throws
return result;
```

This is the EXACT leak class this same session's hardener D0 pass already
fixed elsewhere in this ticket (`renderAndExtract` in
`bl994LiveScreenGridSteps.js`, "closed its jsdom window with a bare call
at the end of the function, unreached on any earlier throw... an open
window with live setInterval polls hung the acceptance run indefinitely
once before"). `080b30253`'s `renderLiveScreenExpanded` wraps the entire
body in `try/finally` so `dom.window.close()` always runs, matching that
established convention.

## Recommendation

Review `00e185819` (cleaner tip carrying `080b30253`) instead of
`3d83c16171`. If architect prefers to keep whatever they've already
started reviewing, at minimum port the `try/finally` guard from
`080b30253` before this lands - `3d83c16171` reintroduces a fixed defect
class.

Not clearing the stale parcel myself (`redo_from.sh`) or overriding
architect's claim - that decision belongs to whoever is holding BL-994
right now. Surfacing so the right commit gets reviewed.
