# Android floating overlay companion (BL-707)

Native system overlay bubble for SwarmForge. Distinct from Mini App
minimize (BL-706): this bubble can stay visible while you leave Telegram.

## What you get

- Movable floating bubble over other apps
- Tap to expand a mini panel
- Discrete text turns to the existing Let's Talk bridge (same console bearer)
- Collapse / stop removes the overlay

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
**versioned** filename (e.g. `swarmforge-float-companion-0.1.2-BL707.apk`) so
browsers/CDNs cannot keep serving a cached older APK via HTTP 304.

On the phone: **install the new APK over the existing app** (do not
uninstall). Pairing (bridge URL + token) is kept in app prefs across
updates. Confirm the status line shows the matching version (e.g.
`BL-707 v0.2.4`) before Start bubble.

If you do uninstall: choose **Keep app data** when Android asks, or rely
on the `Download/swarmforge-float-pairing.json` mirror the app writes —
open the new install and the fields should refill.

## Pair

1. Open the app.
2. Paste your bridge base URL (same host as the Mini App), e.g. the
   Cloudflare tunnel base.
3. Paste the console control token (same bearer as Let's Talk —
   `.swarmforge/operator/bridge-token`).
4. Grant **Display over other apps**.
5. Tap **Start bubble**.

## Talk

Tap the bubble. You get a **Let's Talk**-style panel:

- **Record** — hold/tap to capture a voice turn (same `/lets-talk/turn` audio path)
- **Hands-free** — auto-listen after the reply finishes (keeps listening
  while the panel is collapsed to the bubble; bubble color shows phase)
- **Hold music** — chiptune while thinking (same Zappa set as the Mini App)
- **Mute** — skip speaking the reply
- **Pause all** — stops mic, playback, and hold music
- Optional text field for typed turns
- **Collapse** — hides the panel, shows the bubble; does **not** stop
  hands-free / mid-turn mic (owned by the overlay service)
- **Stop** — tears down bubble + voice session

Grant **microphone** when Android asks (first Record).

## Stop

Use **Stop bubble** in the app, the stop control on the mini panel, or
**drag the bubble down onto the red X** that appears at the bottom while
dragging (Messenger-style dismiss). The overlay must disappear; start
again later when you want it.

## Android Studio (optional)

Open `android/` in Android Studio (SDK 34+, JDK 17) to sync Gradle and
run on a device/emulator.
