# BL-908 — architect SEND BACK: the sync trigger becomes permanently unreachable after the first successful sync

**Parcel:** cleaner-forwarded commit `49ac0cf0c0` (coder's `5544bc9a9` +
cleaner's dedup pass), merged for architect review at this commit on
`swarmforge-architect`.

**Complete review inventory (Article 4.4 — one bounce, this is the only item):**

- Testability boundary (BL-769): PASS. `KnowledgeReader.kt` is pure, no
  `android.*` type in any signature; `KnowledgeActivity.kt` is thin
  device-surface wiring delegating every decision to it.
- Invariants review (BL-633/654): PASS. Both declared invariants
  ("nothing fetched/derived at browse time", "no view presents content
  without its generation") are structurally enforced (`Ready` requires a
  generation by construction; `backlogPanelState`/`docsPanelState` take no
  network-capable type) AND have non-vacuous coder-authored property tests
  in `KnowledgeReaderPropertyTest.kt` (each with a "buggy reader would fail
  this" companion).
- Dependency-gate hard gate (BL-259): ran full-repo scan (parcel touches no
  `extension/src/**` file) — 3 pre-existing `acyclic` violations found, all
  in `telegram-front-desk-bot.ts`/`telegramCursorOperator*.ts`, none touched
  by this parcel. Unrelated, not blocking.
- Co-change (BL-255): ran against the parcel's changed files. No new
  concerning coupling — `TalkPanelActivity.kt`'s high co-change count is a
  pre-existing hub-file pattern; this parcel's own change to it is a 3-line
  button wire-up.
- Feature/step-handler wiring: PASS. All 6 scenarios' `currentExpectedTest`
  mappings in `bl908BubbleKnowledgeScreenSteps.js` resolve to real,
  correctly-named tests that exist in `KnowledgeReaderTest.kt` /
  `KnowledgeReaderPropertyTest.kt` — checked each by hand, not assumed.
- Layout bindings: PASS. Every `binding.<id>` referenced in
  `KnowledgeActivity.kt` exists in `activity_knowledge.xml`.
- Property-testing pass (architect-owned, undeclared coverage): no gap
  found worth adding to. The malformed/parse-rejection path is already
  covered by ample example tests plus the structural `try/catch(Exception)`
  guard in both `parseBacklogPackage`/`parseDocsPackage`.

**D1 (correctness defect, BL-333-class — architecturally clean, still a
send-back):** the only sync trigger in the entire app becomes permanently
unreachable once any package has synced successfully once.

- `KnowledgeActivity.kt:51-58` (`sync()`) is the sole caller of
  `CompanionPackageStore.sync` in the whole main source tree — confirmed by
  `grep -rn "CompanionPackageStore.sync" android/app/src/main`, one hit.
  There is no periodic/background job (`grep` for
  `WorkManager|PeriodicWork|AlarmManager|JobScheduler` under
  `android/app/src/main`: zero hits) and no other trigger in
  `TalkPanelActivity`'s settings dialog (`grep` for `sync` in
  `showSettingsDialog`: zero hits).
- The button that calls it, `syncBtn`, is declared as a *child* of
  `emptyState` in `activity_knowledge.xml:121-144`. `showList` (called for
  every `Ready` state, both panels) sets
  `binding.emptyState.visibility = View.GONE` (`KnowledgeActivity.kt:127`),
  taking `syncBtn` with it. `showEmpty` (called only for `NothingHeld` /
  `Malformed`) is the only path that ever makes it visible again.
  Once both the backlog and docs packages have synced once (the normal,
  expected state after first use), no code path ever returns either panel
  to `NothingHeld`/`Malformed`, so `emptyState` — and `syncBtn` inside it —
  never reappears for the remaining life of the app.
- Confirmed in-scope for this ticket, not deferred: BL-907's own
  documentation says so explicitly —
  `docs/how-to/BL-907-bubble-offline-package-sync.md:8`: "BL-908 builds the
  browse UI on top of what this ticket stores." BL-907 deliberately shipped
  no UI trigger; BL-908 is where one was supposed to land.
- Breaks the ticket's own `qa_e2e_procedure` (BL-908 YAML) step 8: "Change
  the backlog on the host, sync, reopen the backlog panel — expect the new
  content and the stated generation moved with it." There is no way to
  perform "sync" as a manual UI action at that point in the procedure —
  step 3 already synced once, and steps 4-7 never leave the `Ready` state.
- Defeats the ticket's own product intent
  (`description:` in the YAML — "Provenance on every view... cached content
  never passes for live"): a screen that can be refreshed exactly once per
  install is not a browsable knowledge screen that "stays current," it is a
  snapshot with a broken refresh button.

**Remediation:** give the sync trigger a permanent home outside `emptyState`
— e.g. a persistent sync/refresh action always visible on the knowledge
screen (a toolbar icon, a button beside `closeBtn`, or similar), not
conditioned on `NothingHeld`/`Malformed`. The `emptyState`'s own "Sync now"
copy can stay as the first-run affordance; it just cannot be the *only* one.
Re-run the JVM suite and the BL-908 feature scenarios after the fix (no
scenario currently exercises re-sync-after-Ready, so this defect passed the
existing suite silently — worth a beat of thought on whether a
`KnowledgeActivity` device-surface manual-procedure note or an additional
`KnowledgeReader`-level test is the right place to pin this down going
forward, coder's call).

By architect.
