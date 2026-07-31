# Android floating overlay companion (BL-707)

Native system overlay bubble for SwarmForge. Distinct from Mini App
minimize (BL-706): this bubble can stay visible while you leave Telegram.

Current debug line: **BL-707 v0.3.8-home-handsfree** (`versionCode` 24). Confirm
that string on the pairing screen status line after you install.

## What you get

- Movable floating bubble over other apps (phase shown by bubble color)
- Tap to expand a Let's Talk panel; long-press the bubble to pause / resume all
- Voice and typed turns to the existing Let's Talk bridge (same console bearer)
- Hands-free listening that continues while collapsed to the bubble
- Settings: hold music, mute, playback volume (default 55%)
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

That copies into `.swarmforge/operator/public/` (Cloudflare tunnel). Prefer the
**versioned** filename (e.g.
`swarmforge-float-companion-0.3.8-home-handsfree.apk`) so browsers/CDNs cannot
keep serving a cached older APK via HTTP 304.

On the phone: **install the new APK over the existing app** (do not
uninstall). Pairing (bridge URL + token) and talk prefs (volume, mute, hold
music, preferred song) stay in app storage across updates. Confirm the status
line shows the matching version (e.g. `BL-707 v0.3.8-home-handsfree`) before
you rely on new controls.

If you do uninstall: choose **Keep app data** when Android asks, or rely
on the `Download/swarmforge-float-pairing.json` mirror the app writes —
open the new install and the fields should refill.

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
- **Volume** — shared loudness for hold music and reply voice, 0–100,
  default 55 (Settings; live while playing)
- **Pause all** — stops mic, playback, and hold music (panel control, or
  long-press the bubble)
- **New session** — clears the shared Cursor agent id (same idea as Mini App `/new`)
- Optional text field for typed turns
- **Collapse** — hides the panel, shows the bubble; does **not** stop
  hands-free / mid-turn mic (owned by the overlay service)
- **Stop** — tears down bubble + voice session

Grant **microphone** when Android asks (first Record).

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
