# Android floating overlay companion (BL-707)

Native system overlay bubble for SwarmForge. Distinct from Mini App
minimize (BL-706): this bubble can stay visible while you leave Telegram.

Current debug line: **v0.3.17-open-talk** (`versionCode` 33, applicationId
`com.swarmforge.float`). Confirm that string under the Let's Talk title on the
talk panel (and on the pairing screen status line if you still see it). The
`com.swarmforge.float` application id is unchanged from BL-707's original
0.3.13 release — it does not need to be new again for this update.

## What you get

- Movable floating bubble over other apps (phase shown by bubble color)
- Tap to expand a Let's Talk panel; long-press the bubble to pause / resume all
- Voice and typed turns to the existing Let's Talk bridge (same console bearer)
- Hands-free listening that continues while collapsed to the bubble
- Settings: hold music, mute, hold-music volume (default 55%; reply voice follows phone volume)
- Playlist: shuffle or pin a preferred hold-music tune
- Day-to-day: open the app → bubble auto-starts and the pairing UI finishes away
- Collapse hides the panel only; **Stop** or drag-to-X tears the overlay down

## Sideload (debug APK)

A debug APK can be built on the bridge host without Android Studio:

```bash
# one-time: portable JDK 17 + Android SDK under .swarmforge/
# then:
cd android
printf 'sdk.dir=%s\n' "$HOME/swarmforgevc/.swarmforge/android-sdk" > local.properties
# (adjust sdk.dir to your .swarmforge/android-sdk path)
./gradlew :app:assembleDebug
```

APK path: `android/app/build/outputs/apk/debug/app-debug.apk`

After each build, publish into the sideload folder the phone downloads from:

```bash
android/scripts/publish-apk.sh
```

That copies into `.swarmforge/operator/public/` and the bridge serves them
at `https://bubble.musicalsifu.com/<filename>` (no bearer). Prefer the
**versioned** filename (e.g.
`swarmforge-float-companion-0.3.17-open-talk.apk`) so browsers/CDNs cannot
keep serving a cached older APK via HTTP 304.

On the phone: install
`https://bubble.musicalsifu.com/swarmforge-float-companion-0.3.17-open-talk.apk`.
This build uses applicationId `com.swarmforge.float`, so it updates in place
over any earlier build on that same id (0.3.13 and later). Confirm the talk
panel shows `v0.3.17-open-talk`, then re-pair if fields are empty (or rely on
`Download/swarmforge-float-pairing.json`).

You can uninstall leftover **SwarmForge Float** / **SwarmForge Bubble** icons
from older package ids when convenient — they are separate apps now.

### "App not installed" on an older APK

If an older build still fails that way: uninstall every SwarmForge Float/Bubble
entry (all users if offered), or switch to the current `0.3.13-fresh-id` APK
above.

## Pair (first run or re-pair)

1. Open the app.
2. Paste your bridge base URL (same host as the Mini App), e.g. the
   Cloudflare tunnel base.
3. Paste the console control token (same bearer as Let's Talk —
   `.swarmforge/operator/bridge-token`).
4. Grant **Display over other apps**.
5. Tap **Start bubble**.

When URL, token, and overlay permission are already good, launching the app
**auto-starts the bubble** and leaves the pairing screen. To change URL or
token later: open **Settings** on the talk panel → **Edit pairing**.

## Talk

Tap the bubble. You get a **Let's Talk**-style panel:

- **Record** — hold/tap to capture a voice turn (same `/lets-talk/turn` audio path)
- **Hands-free** — auto-listen after the reply finishes (keeps listening
  while the panel is collapsed to the bubble; bubble color shows phase)
- **Hold music** — chiptune while thinking (same catalog as the Mini App,
  including BL-705 iconics). Toggle lives under **Settings**
- **Playlist** — shuffle, or pin one tune for the next hold loop; stop music
  from the same dialog
- **Mute** — skip speaking the reply (Settings)
- **Hold music volume** — loudness for hold music only, 0–100, default 55
  (Settings; live while playing). Reply voice follows the phone’s volume.
- **Pause all** — stops mic, playback, and hold music (panel control, or
  long-press the bubble)
- **New session** — clears the shared Cursor agent id (same idea as Mini App `/new`)
- Optional text field for typed turns
- **Collapse** — hides the panel, shows the bubble; does **not** stop
  hands-free / mid-turn mic (owned by the overlay service)
- **Stop** — tears down bubble + voice session

Grant **microphone** when Android asks (first Record).

## The reply always plays something after hold music stops (BL-717)

Hold music stopping with nothing spoken afterward used to be indistinguishable
from a turn that was still running. It no longer happens: whenever a turn has
no speakable content to play — no audio and no TTS text — or the playback/TTS
attempt itself fails, or the recovery watchdog expires, the app makes one
bounded recovery attempt instead of silently completing the turn. Combined
with the bridge-side fallback line for a reply with nothing pronounceable to
say (same ticket — see the "Record a Turn" note in the
[main Let's Talk how-to](BL-696-miniapp-lets-talk-cursor-audio.md)), a turn
now always ends in either the real reply or an audible failure — never
open-ended silence.

## Cold-start expand no longer fails silently (BL-916)

A short tap on the bubble right after a cold start (no foreground activity
— e.g. right after force-stopping the app) used to draw the disc but do
nothing: Android's background-activity-launch block (Samsung especially)
silently dropped the panel start, no crash and no log. Expand now
trampolines through the app's own exported launcher activity instead of
starting the Talk panel directly from the background overlay service, so
the platform allows it. Two related freezes fixed in the same pass, since
all three looked identical to the user — "the bubble is frozen":

- The pairing screen no longer gets stuck behind the Android 12+ launcher
  splash icon when Talk is opened from the bubble.
- The Talk panel no longer closes itself the instant it opens (the
  overlay's own finger-up was being read as an outside tap).

This does not change the gesture model — expand is still a single tap.

## When the bridge host is unreachable (BL-716)

If the paired tunnel hostname stops resolving, or the tunnel edge itself is
dead, a turn no longer looks like a healthy, silently-stuck recording. The
bubble turns **red** (error phase), and the panel shows a plain-language
reason instead of a raw DNS exception or Cloudflare error body — e.g. "Can't
find the bridge host — pairing URL may be stale." with a hint to check
**Settings → Edit pairing**. Recording stops for that turn; hands-free resumes
listening once the failure clears.

### Re-pairing without hunting logs

The quick-tunnel hostname changes whenever the host's Cloudflare tunnel
restarts. Two ways to get the phone back on the live URL, no manual log
digging or retyping:

- **Deep link (near-term default)** — the operator's Telegram tunnel-notify
  topic carries an **"Update Bubble pairing"** button/link
  (`swarmforge-bubble://pair?url=...&token=...`). Tap it on the phone and
  Bubble re-pairs itself and shows "Bubble pairing updated" — no need to open
  the app or edit fields by hand.
- **Manual re-pair** — still available via **Settings → Edit pairing** on the
  talk panel, same as first-run pairing above.

A stable named Cloudflare tunnel (so the hostname stops rotating at all) is
the longer-term direction; until then, use the deep link.

## Stop

Use **Stop** on the mini panel, **Stop bubble** on the pairing screen, or
**drag the bubble down onto the red X** that appears at the bottom while
dragging (Messenger-style dismiss). The overlay must disappear; start
again later when you want it (opening the app is enough once paired).

## Android Studio (optional)

Open `android/` in Android Studio (SDK 34+, JDK 17) to sync Gradle and
run on a device/emulator.
