# Bubble's Live page ships as remote HTML, one shared renderer (BL-775)

Human ruling, 2026-08-06: "Remote HTML for all 4, and flip BL-775 to
remote." This slice does not re-implement the coordinator + resident
Live Screen in Kotlin — it publishes the bridge's existing Live Screen
renderer as a second page in Bubble's UI bundle (per
[BL-829's pager](BL-829-bubble-remote-page-pager.md)), so BL-825/BL-829's
pager can open it beside Talk.

## Invariant 1: one renderer, not a copy

`residentSpyUiHtml.ts` exports `renderLiveScreenBody()` — the entire Live
Screen document (markup, style, script). Both the Telegram Mini App's
`getResidentSpyUiHtml()` and Bubble's `bubbleLiveUiHtml.ts`
(`getBubbleLiveUiHtml()`) call this same function and serve it
byte-identical. A change to what Live shows lands on both surfaces by
construction; there is no second copy to drift.

## Where it's served

- `bridgeServer.ts`'s pre-auth Mini App shell dispatch: `isBubbleLivePath(url)`
  matches `/live`, serves `getBubbleLiveUiHtml()`.
- `letsTalkRoutes.ts`'s `bubbleLivePage` (`id: 'live'`, `entryPath: 'live'`)
  is merged into the UI bundle manifest by
  `mergeBubbleLiveIntoUiBundleManifest`, following the same pattern as the
  health/host/operator-docs pages — this is what lets BL-829's pager list
  and open it.

## Read-only, per invariant 2

This page adds no bridge contract: it reads the same `/resident-pane`
snapshot the Mini App Live Screen already reads, under the same read
auth. No code path from the page reaches a mutating bridge endpoint.

## Invariant 3: a failure reason, never a bare status

Two gaps closed in the same parcel so the rendered page never shows less
than the evidence it has:

- `tryCaptureRolePane` (`residentPaneLive.ts`) no longer returns bare
  `undefined` on a failed tmux capture — a pane's `reason` carries through
  to the full-screen view instead of the flat `(pane not reachable)` text.
- The client-side poll no longer discards the bridge's own JSON error
  body on a failed fetch; `lastFetchErrorReason` holds it, and the
  offline banner text was reworded ("Swarm is idle — no live panes right
  now") so a quiet swarm doesn't read as broken.

## Cast, navigation, refresh — the locked decisions this page honours

Carried from `INTAKE-bubble-live-screen-coordinator-resident.md`
(2026-07-31): the overview shows coordinator and resident
(mono-router shape); tap either for a full-screen pane view with the
ticket strip (id, title, role, model, claim-age) still visible; refresh
stays at the existing 1500 ms Mini App poll cadence — no new continuous
stream in this version.

## Verify

```bash
cd extension
npm test -- residentSpyUiHtml bridgeServer residentPaneLive bl775BubbleLiveScreenShell
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-775-bubble-live-screen-shell.feature
```

Acceptance: `specs/features/BL-775-bubble-live-screen-shell.feature`.
