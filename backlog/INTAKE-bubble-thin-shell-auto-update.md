# Raw intake — Bubble: thin native shell + auto-refresh UI (chiptunes-style updates)

Status: new intake, not minted. Capture only (human via Let's Talk / Cursor
2026-07-31). Human asked for intake so the specifier can weigh in — not a
pre-minted ticket.

Related
- BL-707 — Android floating overlay companion; today most UI is compiled into
  the APK. Chiptunes catalog and `bubble-config.json` already refresh from the
  bridge without reinstall (`BridgeClient` fetch on session).
- Tonight’s Bubble screen intakes (Notes, Control, Live, Pipeline,
  clarification blink) — if those ship as remote UI inside the shell, they
  inherit auto-update; if compiled native-only, every screen change forces
  APK reinstall. Specifier should sequence architecture vs screen features.
- Mini App ports policy (Pipeline / Live intakes): Bubble becomes the phone
  surface; remote UI may reuse bridge HTML/read models already served for
  Mini App.

## Goal

When the human opens Bubble, they get the latest small updates without
manually reinstalling the app. Keep a bare-minimum native shell installed.
Ship most screens and soft updates over the bridge the way chiptunes already
update. Only bump the APK when the shell itself must change.

## Problem

- New Bubble builds today mean sideload / reinstall.
- Human is often away from desk; reinstall friction kills the update loop.
- Chiptunes already prove remote refresh works; the app UI does not yet
  generalize that pattern.
- A growing pager of screens (Talk, Notes, Control, Live, Pipeline, …) will
  churn often — APK-per-change does not scale for phone use.

## Why this matters

- Bubble is the always-on operator surface; it must stay current cheaply.
- Separates rare native/platform changes from frequent product UI changes.
- Matches the human’s mental model: open Bubble, it is up to date.

## Human decisions locked in this conversation (2026-07-31)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Auto update for most of the app.** Opening Bubble should pick up new
   version content without a manual reinstall for ordinary updates.
2. **Thin shell.** Keep a bare-minimum installed native companion: overlay
   window, mic / talk engine hooks, permissions, bridge reachability, and
   enough glue to fetch and show remote UI.
3. **Generalize the chiptunes path.** Catalogs/config already refresh from
   the bridge; extend that pattern to most screens / soft updates so they
   “just arrive” on the phone when the host serves a newer bundle.
4. **APK only when needed.** Native shell changes (new permissions, overlay
   behavior, mic pipeline, install glue) still require an APK bump; human
   accepts that rare path. Prefer a clear “shell update available” prompt
   when the binary must change — not hunting an APK by hand.
5. **Out of pretending.** Do not claim Play-silent full binary OTA if the
   distribute path is sideload; be honest about confirm-for-APK vs auto-for-
   remote-UI.

## Requested outcome

1. Architecture: native shell + remotely fetched UI/assets (WebView shell,
   remote compose bundle, or specifier-chosen equivalent) versioned from the
   bridge.
2. On open / expand: fetch current UI bundle + config; show new screens
   without reinstall when only remote content changed.
3. Shell version check: if companion binary is behind minimum required,
   prompt to update APK (download + install flow), not silent fail.
4. Chiptunes / bubble-config keep working; do not regress them.
5. How-to documents “soft update” vs “shell update” for the human.

## Acceptance shape to refine

1) Change a remote-only screen or asset on the host → reopen Bubble → new
   content appears with no APK reinstall.
2) Chiptunes / config refresh still works as today.
3) When shell semver / minimum is bumped → Bubble prompts for APK update
   and can complete install with user confirm (sideload-safe).
4) Offline / bridge down → last cached remote UI or clear degraded state;
   no crash loop.
5) Ordinary Talk still works from the shell if remote UI fails to load
   (specifier: define minimum offline surface).

## Out of scope

- Rewriting every tonight screen intake before this architecture lands
  (sequence is specifier-owned; call the dependency out).
- Full Play Store publication unless human asks.
- Minting without specifier disposition.

## Suggested type / priority hint for mint

- type: feature / architecture (enables cheap iteration on all Bubble screens)
- mutation_cost: high (Android shell split + bridge UI bundle serving +
  versioning + cache + APK update prompt; Android acceptance-seam / BL-761
  applies)
- Strong candidate to sequence **before** or **with** the big Bubble pager
  screen batch, or as epic slice A under a Bubble-shell epic.
- Not offline expeditor unless the human asks — but it multiplies every
  later Bubble ticket’s ship cost if skipped.

## Specifier: please weigh in

Open questions the human did not fully lock:
- WebView hosting bridge HTML vs other remote-UI tech.
- Cache / pin policy when tunnel is down.
- Minimum shell surface if remote bundle missing (Talk-only?).
- How shell APK is distributed (local bridge download, GitHub release, other).
- Versioning scheme for UI bundle vs APK (`bubble-config` flags vs semver).
