# Bubble's browsable knowledge screen — backlog and docs panels (BL-908)

Bubble now has a screen you can read the swarm from with no bridge in reach:
a backlog panel over the four ticket folders and a docs panel over the
vision documents, both browsed entirely from what BL-907's
`CompanionPackageStore` already holds on the device. This is the phone-side
UI slice of epic BL-865 (Bubble offline-first sync) and the native-Kotlin
retarget of BL-659's corpus goals the human confirmed on 2026-08-16 — the
previously-approved PWA knowledge-explorer becomes this screen, and the
Pages PWA goes maintain-only rather than being retired.

## Reaching it

`TalkPanelActivity`'s expanded bubble gained a `knowledgeBtn` alongside
Settings and the playlist — tapping it opens `KnowledgeActivity` directly,
with no re-pairing step.

## The pieces

- **`KnowledgeReader`** (pure Kotlin, no `android.*` type in any signature —
  the Bubble testability boundary, BL-769) holds every panel DECISION: what
  a folder lists, what a ticket's detail shows, what a document opens to,
  and what generation a view states. It reads only a
  `CompanionPackageSync.ReadResult` — never a network call — so a `Ready`
  state is reached identically with the network on or off. Each panel
  resolves to one of three states: `NothingHeld` (nothing has synced yet),
  `Malformed` (the held package failed to parse — whole-package rejection,
  same posture as `CompanionPackageSync`), or `Ready(generation, content)`.
  A `Ready` state cannot be constructed without a generation, so BL-908's
  second invariant ("no view presents package content without stating the
  generation it was read at") holds by construction, not by convention.
  Covered by the JVM unit suite (`./gradlew :app:testDebugUnitTest`) plus
  non-vacuous property tests in `KnowledgeReaderPropertyTest.kt` for both
  declared invariants.
- **`KnowledgeActivity`** is the device-surface wiring: two tabs (backlog,
  docs), four folder chips for the backlog tab (active, paused, hold,
  done), a list that opens a ticket or document detail in a dialog, and a
  generation label shown whenever a panel is `Ready`. Every decision it
  renders comes from `KnowledgeReader`; the activity itself only maps
  state to views.

## The sync trigger has a permanent home

An earlier version of this screen only offered "Sync now" inside the
empty/first-run state — once both packages had synced successfully, that
button (and its container) went `GONE` for the rest of the app's life, with
no other way to trigger a re-sync. `KnowledgeActivity` now also has
`syncBtnHeader`, a persistent header action next to the close button,
present in every state (`NothingHeld`, `Malformed`, and `Ready`). The
empty-state "Sync now" button stays as the first-run affordance; it is no
longer the *only* way to refresh.

## Nothing held reads as nothing held

Before a first sync, or when a held package fails to parse, a panel says so
and offers to sync, rather than showing an empty list that looks like an
empty backlog or an empty docs tree.

## Not in this slice

- Fetching or caching anything — BL-907 owns the sync; this slice only
  reads what BL-907 already stored.
- Search, facet chips with counts, completion rings, ETAs, cross-links, and
  the Miller-column interaction from BL-659's mockup — later BL-659 slices.
- Corpus roots the bridge does not serve yet (constitution, briefings,
  evidence, features, FLOW, COST) — each needs a bridge package first.
- Rendering mermaid diagrams. A diagram document opens to its source,
  labelled as a diagram, not a rendered image.
- Editing anything from the screen — read-only, as BL-659 ruled.

## Verifying it (device-surface — no JVM suite coverage here)

The panel decisions above are proven by the unit and property suites. The
screen and list wiring is device-surface (per the Testability Boundary —
see `docs/how-to/BL-769-android-jvm-unit-suite.md`) and is verified by this
recorded manual procedure, Bubble paired to a live bridge with BL-907
landed:

1. From the floating bubble, reach the knowledge screen — reachable without
   re-pairing and without leaving Bubble.
2. Fresh install, before any sync — the panel says nothing is held and
   offers to sync, not an empty ticket list.
3. Sync, open the backlog panel — each folder lists the tickets the host
   actually holds under it (spot-check a count against `ls backlog/active/`
   on the host).
4. Open one ticket — the title and description the host's YAML carries.
5. Open the docs panel — the five vision documents; a markdown one shows
   its text, a diagram one shows its source, labelled as a diagram.
6. Read the generation stated on each panel — matches the generation
   `GET /companion-manifest` advertises for that package on the host.
7. Airplane mode, repeat steps 3-6 — identical content, no failure anywhere
   in the browse.
8. Change the backlog on the host, tap the header sync action, reopen the
   backlog panel — the new content and the stated generation moved with it.
   (This is the step the missing permanent sync trigger used to break —
   the empty-state button is gone by this point in the procedure.)
