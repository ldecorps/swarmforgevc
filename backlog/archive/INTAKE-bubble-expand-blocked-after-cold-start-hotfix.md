# Raw intake — Bubble expand blocked after cold start; Cursor-agent hotfix needs swarm stamp

Status: new intake, not minted. Capture only (human via Cursor 2026-08-17,
landed same evening). **Operator/Cursor hotfix already in the tree** —
same posture as BL-811 / BL-849 / BL-879 / BL-886: the commit makes it
reviewable; this intake asks the swarm to review-stamp it through the
normal chain, not to re-implement from scratch.

The human confirmed live on the phone the same evening: "It's working as
expected then. Let swarm know about this hotfix."

Related (do not conflate)
- **BL-828** (paused) — collapsed-bubble *gesture* model (double-tap
  expands, idle tap starts the mic). This hotfix keeps today's single-tap
  expand. Do not fold the redesign into the stamp ticket.
- **BL-824** / **BL-825** / **BL-829** (paused epic + children) — remote
  UI pager. Expand started working again, so Knowledge / pager pages are
  reachable; this ticket does not implement them.
- **BL-908** (done) — Knowledge native screen. Visible once expand works;
  not in this diff.
- **BL-788** (done) — 2026-08-02 pairing + client-logs adopt. Different
  surface (pairing identity / logs), not the cold-start expand path.
- **BL-707** (done) — original overlay companion. This is a follow-on
  launch-path defect on that shell.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-811 /
   BL-849 shape): verify the landed expand-path hotfix is correct,
   guarded, and does not re-introduce the Samsung splash freeze; stamp it
   off through the normal chain.
2. Acceptance must prove the live failure mode: after force-stop / cold
   start the floating disc was drawn but a short tap did nothing, because
   Android/Samsung dropped `startActivity` from the overlay service when
   no activity was in the foreground. The user experience was "frozen
   bubble."
3. Also prove the two follow-on freezes this same hotfix had to close
   while iterating on the phone:
   - finishing `MainActivity` from `onCreate` after starting Talk left
     the Android 12+ splash (giant launcher lightbulb) stuck on screen;
   - `windowCloseOnTouchOutside=true` on the dialog panel treated the
     overlay finger-up as an outside tap and finished the panel
     immediately (again looked like a frozen bubble).
4. Do **not** widen into BL-828's gesture redesign, BL-659 miller-column
   Knowledge drill-down, or APK-distribution policy.

## What landed (Cursor agent, 2026-08-17 ~17:15–18:53 local)

Shipped to the phone as `0.3.17-open-talk` (`versionCode` 33;
sideload `swarmforge-float-companion-0.3.17-open-talk.apk`). Iterated
through 0.3.15-expand-fix and 0.3.16-splash-fix on the same path; 0.3.17
is the build the human confirmed.

### Observable incident

- Human expanded the bubble to look at Knowledge. Disc appeared; short
  tap did not open Let's Talk. Force-stop did not help — it started
  collapsed and stayed that way.
- Root cause: `OverlayService.openTalkPanel()` called
  `startActivity(TalkPanelActivity)` from a background overlay. After a
  cold start there is no foreground activity, so the BAL / Samsung
  background-activity block drops that start silently.

### Fix in tree (files)

- `android/app/src/main/java/com/swarmforge/floatcompanion/OverlayService.kt`
  — trampoline through exported `MainActivity` with
  `EXTRA_OPEN_TALK`; send a `PendingIntent` with
  `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` on API 34+; briefly clear
  `FLAG_NOT_FOCUSABLE` on the overlay during the tap so the gesture
  counts as user interaction; FGS notification also carries the same
  extra.
- `android/app/src/main/java/com/swarmforge/floatcompanion/MainActivity.kt`
  — stop finishing the pairing task from `onCreate` (that froze the
  splash). Keep the pairing/control screen alive; start the overlay in
  the background; open Let's Talk from a real tap here, or from the
  bubble via `EXTRA_OPEN_TALK`. Paired primary button label becomes
  "Open Let's Talk".
- `android/app/src/main/java/com/swarmforge/floatcompanion/TalkPanelActivity.kt`
  — retry engine bind (~1s) instead of inflating against a service that
  has not come up yet; skip `onUserLeaveHint` auto-finish (Home was
  collapsing into a stuck panel/task); guard `onSnapshot` until the
  talk binding exists.
- `android/app/src/main/res/values/themes.xml` —
  `windowCloseOnTouchOutside=false` on the panel dialog (the overlay
  finger-up was finishing the panel); `windowDisablePreview=true`.
- `android/app/src/main/res/values-v31/themes.xml` — Android 12+ splash
  uses a dark background and a transparent icon so the giant lightbulb
  cannot stick.
- `android/app/src/main/res/values/strings.xml` — `open_lets_talk`.
- `android/app/build.gradle.kts` — `versionCode` 30→33,
  `versionName` `0.3.14-echo-ptt`→`0.3.17-open-talk`.

### Live verification already done

- Human installed the versioned APK, opened the app, confirmed Let's Talk
  (and Knowledge) on 2026-08-17, and said the hotfix is working as
  expected.

## Out of scope for this stamp ticket

- BL-828 double-tap / idle-mic gesture model.
- Knowledge miller-column drill-down (BL-659) — still mock-only; BL-908
  remaining a list + dialog peek is expected.
- Changing `applicationId` / sideload hosting (BL-851 already stamped).
- Remote-page content for the pager (BL-830 children).

## Locked human decisions

1. Treat this as **swarm-review stamp-off of a landed hotfix**, not a
   greenfield implement ticket (same posture as BL-811 / BL-849).
2. Severity **high** — the collapsed bubble is the product's only
   day-to-day entry; after cold start it did not open at all.
3. Keep single-tap expand. Do not take this as approval of BL-828.
4. Do not restore `finishAndRemoveTask()` of `MainActivity` from
   `onCreate` — that was the splash freeze. Pairing UI staying on
   screen when the user opens the app icon (with Let's Talk launched
   from a tap) is the accepted trade-off.
