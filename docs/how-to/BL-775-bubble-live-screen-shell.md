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

## Every live seat gets a tile, not just the ones `./swarm` launched with (BL-1858)

`sessions.tsv` is written only by `swarmforge.sh`'s `write_sessions_file`,
at a full `./swarm` launch; a seat enabled afterwards by editing
`roles.tsv` and running `./swarm ensure` (the usual way to swap in a
local-model seat such as `coder@2`) gets a live tmux session but no
`sessions.tsv` row, and art-director had no row either on 2026-10-01. The
grid used to read only `sessions.tsv`, so a
roster could run ten seats and show eight tiles.

`tmuxClient.ts`'s `readRosterSwarmRoles` fixes this: every `roles.tsv`
row (`parseRosterLine`), then every `sessions.tsv` seat `roles.tsv`
lacks. `readLiveRosterSwarmRoles` intersects that with live tmux
sessions, and `captureLiveScreenPanes` (`residentPaneLive.ts`) uses it
instead of the old `sessions.tsv`-only roster. The invariant: the live
grid has exactly one tile per seat either file lists whose tmux session
is live, and none for a live session neither lists.

A numbered seat (`coder@2`) sits right after its base role's tile
(`seatBaseRole('coder@2')` → `'coder'`), via `orderLiveScreenRoles`, not
wherever it happens to fall in roster order. The served page
(`residentSpyUiHtml.ts`) steps to a tighter font at 9 and 10 tiles so a
full local-model roster still fits: two columns on a phone, five on a
wide screen.

Each tile head also names the seat's own model under the role name
(`pane.modelLabel`), Claude seats included (`Sonnet 5`, `Opus 5.5`), not
only the local-model seat. `backendSwitch.ts`'s launch-script detection
recognises a line starting `qwen` (the Ollama local-model launcher);
`modelDisplayName.ts` formats an Ollama qwen-coder tag
(`qwen2.5-coder-14b-q5km:latest`) as `Qwen2.5 Coder 14B` rather than
passing the raw tag through.

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
npm test -- residentSpyUiHtml bridgeServer residentPaneLive bl775BubbleLiveScreenShell \
  tmuxClient backendSwitch bl1858LiveGridRoster
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-775-bubble-live-screen-shell.feature
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-1858-bubbles-live-grid-shows-a-tile-for-every-live-seat.feature
```

Acceptance: `specs/features/BL-775-bubble-live-screen-shell.feature`,
`specs/features/BL-1858-bubbles-live-grid-shows-a-tile-for-every-live-seat.feature`.
