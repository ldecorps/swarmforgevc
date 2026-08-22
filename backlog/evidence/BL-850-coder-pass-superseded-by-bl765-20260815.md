# BL-850 coder pass — 20260815

Received as a "Work BL-850" note from the coordinator. BL-850's premise (an
uncommitted human hotfix sitting in the master checkout at mint time,
2026-08-07, that this ticket must LAND then review) no longer matches
reality. Recording findings rather than forwarding a no-op parcel (Article
1.9 / 2.3.2).

## What I checked

1. **No uncommitted diff exists.** `git status` in this worktree (fresh off
   a `git merge main` earlier this turn) is clean for every path BL-850
   names (`android/app/src/main/java/com/swarmforge/floatcompanion/TalkEngine.kt`,
   `ReplyAudioPlayer.kt`, `strings.xml`, `build.gradle.kts`,
   `publish-apk.sh`, the two how-tos). There is nothing to `git add` and
   commit with a `Hotfix-Certification: pending` trailer.

2. **The exact contract BL-850 wants is already landed — via BL-765, not a
   hotfix commit.** `ReplyGain.kt`
   (`android/app/src/main/java/com/swarmforge/floatcompanion/ReplyGain.kt`,
   introduced at `b0e59b60425a9a2188f9bbe9ee7d31be4eeb6c9f`, "BL-765: serve
   Bubble's capability flags and hold-music catalog from the bridge") defines
   `ReplyGain.independentOfMusicVolume(musicVolumePercent): Float = 1f` —
   ignores its input, always returns full gain. `TalkEngine.kt:76` is the
   ONE call site wiring `ReplyAudioPlayer.setVolume` through this function;
   `ReplyAudioPlayer` applies that single `volumeGain` to BOTH the
   MediaPlayer leg (`mediaPlayer?.setVolume`, `ReplyAudioPlayer.kt:40,238`)
   and the TTS leg (`KEY_PARAM_VOLUME`, `ReplyAudioPlayer.kt:280`) — BL-850
   review goal 1 (both legs) is satisfied by construction, one seam, not two
   to keep in sync.

3. **BL-850's declared invariant already has a BL-654 property test.**
   `android/app/src/test/java/com/swarmforge/floatcompanion/ReplyGainPropertyTest.kt`
   (same commit) asserts `ReplyGain.independentOfMusicVolume(x) == 1f` for
   500 random `x` in `0..100`, plus a non-vacuity companion showing a naive
   coupled reducer would fail it. This is word-for-word BL-850's own
   declared invariant ("the in-app slider scales hold music only; reply
   loudness is owned by the phone's system volume and is never attenuated
   by an app-level default").
   **Could not execute it in this environment**: `./gradlew
   :app:testDebugUnitTest` fails immediately — Android Gradle Plugin
   requires Java 17, this host only has Corretto 11 and Oracle/OpenJDK 8
   installed (`/usr/libexec/java_home -V`). Pre-existing host gap, not a
   BL-850 or BL-765 defect. Verified the property by reading
   `ReplyGain.kt`'s implementation instead: it is a constant-returning
   function with no branch on its argument, so the assertion holds by
   construction.

4. **Goal 2 (nothing else re-couples the two volumes).** Grepped every
   `setVolume`/`volumeGain` site in
   `android/app/src/main/java/com/swarmforge/floatcompanion/*.kt`. Only
   `TalkEngine.kt:76` calls `ReplyAudioPlayer.setVolume`, and only at
   `TalkEngine` init. `TalkEngine.setVolumePercent` (the slider's live
   handler, called from `TalkPanelActivity.kt:250`) touches only
   `holdMusic.setVolume` — it never touches `replyPlayer`. `HoldMusicPlayer`
   has its own independent `volumeGain` (default `0.55f`), unrelated to
   `ReplyAudioPlayer`'s.

5. **Goal 3 (mute / pause-all unchanged).** `muted` / `mutedBeforePause` in
   `TalkEngine.kt` are separate fields from `volumeGain`/`volumePercent`,
   untouched by the BL-765 change; `replyPlayer?.play(result, muted)` passes
   mute state independently of gain.

6. **Goal 4 (docs sweep).** `docs/how-to/BL-707-android-floating-overlay-companion.md`
   and `docs/how-to/BL-705-lets-talk-more-chiptunes.md` both already read
   "reply voice follows the phone's volume" / "(reply voice follows phone
   volume)" — no surface claims a shared control.

7. **Goal 5 (version bump intended, not collateral) — moot.** BL-850's
   "files to review" list names a specific hotfix shape (`versionCode` 24→28,
   `versionName` `0.3.8-home-handsfree`→`0.3.12-reply-phone-volume`). Current
   `android/app/build.gradle.kts` is at `versionCode = 30`,
   `versionName = "0.3.14-echo-ptt"` — later, unrelated tickets moved past
   the exact commit BL-850 describes. There is no `0.3.12-reply-phone-volume`
   commit in this repo's history to review (`git log -S` for that string
   only matches BL-848's own spec-mint commit, not a shipped build).

## Disposition question, not a coder action

BL-850's own `approval_context` already flagged an unresolved fork: "attach
this as a BL-765 acceptance slice, or keep it as the separate sibling
defect." BL-765 has since landed (merged to `main`, QA-approved,
`backlog/done/M8/BL-765-*.yaml`) and its own description explicitly states
this exact volume-split as in scope: "hold-music volume and reply-voice
volume stop sharing one control — the setting governs music only and the
reply voice follows the phone's media volume." The behavior BL-850 asks to
be gated is gated — by BL-765's pipeline (coder→cleaner→architect→
hardener→documenter→QA), not by the hotfix-ledger path BL-850 prescribes.

Nothing here is a coder implementation task: there is no uncommitted diff
to land, and the invariant is already encoded and (by inspection) correct.
Recommending the specifier close BL-850 as satisfied/superseded by BL-765,
or amend it if a residual gap is wanted — that disposition call belongs to
the specifier/coordinator, not to me unilaterally closing my own assigned
ticket.
