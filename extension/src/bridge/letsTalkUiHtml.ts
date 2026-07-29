// BL-696 / BL-697: Telegram Mini App shell for Let's Talk — discrete audio
// turns with optional hands-free listening (auto-start after playback,
// auto-stop on silence). Browser captures audio; STT runs server-side.

import {
  LETS_TALK_HANDS_FREE_MAX_LISTEN_MS,
  LETS_TALK_HANDS_FREE_POST_SPEECH_MS,
  LETS_TALK_HANDS_FREE_SILENCE_MS,
  LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD,
  LETS_TALK_HANDS_FREE_STORAGE_KEY,
} from './letsTalkCore';

export function getLetsTalkUiHtml(speechLocale = 'en-US'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Let's Talk</title>
<link rel="manifest" id="lets-talk-manifest" href="/lets-talk/manifest.json"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="theme-color" content="#0d1117"/>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
    transition: background-color 180ms ease;
  }
  body[data-bridge-state="healthy"] {
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 82%, #238636 18%);
  }
  body[data-bridge-state="degraded"] {
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 78%, #d29922 22%);
  }
  body[data-bridge-state="down"] {
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 75%, #f85149 25%);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  .title-wrap {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .status-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 45%, #000);
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8b949e;
    flex: 0 0 auto;
  }
  .badge[data-state="active"] .dot,
  .badge[data-state="healthy"] .dot {
    background: #3fb950;
  }
  .badge[data-state="inactive"] .dot,
  .badge[data-state="degraded"] .dot {
    background: #d29922;
  }
  .badge[data-state="unsupported"] .dot,
  .badge[data-state="down"] .dot,
  .badge[data-state="error"] .dot {
    background: #f85149;
  }
  a.back {
    font-size: 13px;
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
  }
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
    width: 100%;
  }
  .state {
    font-size: 14px;
    color: var(--tg-theme-hint-color, #8b949e);
    text-transform: capitalize;
  }
  .state[data-phase="error"] { color: #f85149; }
  .state[data-phase="thinking"] { color: #d29922; }
  .state[data-phase="speaking"] { color: #58a6ff; }
  button.record {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 3px solid #f85149;
    background: color-mix(in srgb, #f85149 28%, #111);
    color: var(--tg-theme-button-text-color, #fff);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button.record[aria-pressed="true"] {
    background: #f85149;
    box-shadow: 0 0 0 8px color-mix(in srgb, #f85149 38%, transparent);
  }
  button.record[disabled] { opacity: 0.45; cursor: default; }
  button.secondary {
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 55%, #000);
    background: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 85%, #111);
    color: var(--tg-theme-button-text-color, #fff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  button.secondary[disabled] { opacity: 0.45; cursor: default; }
  button.secondary.warn {
    border: 1px solid color-mix(in srgb, #f85149 60%, #000);
    background: color-mix(in srgb, #f85149 78%, #111);
  }
  .transcript {
    width: 100%;
    max-width: 100%;
    min-height: 3em;
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 90%, #fff 6%);
    font-size: 14px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    word-break: break-word;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .error {
    width: 100%;
    color: #f85149;
    font-size: 13px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  label.hands-free {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
    user-select: none;
  }
  label.hands-free input {
    width: 18px;
    height: 18px;
    accent-color: var(--tg-theme-link-color, #58a6ff);
  }
  .hold-music-title {
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
    font-style: italic;
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <div class="title-wrap">
    <h1>Let's Talk</h1>
    <div class="status-row">
      <span class="badge" id="wake-lock-indicator" data-testid="lets-talk-wake-lock" data-state="inactive"><span class="dot" aria-hidden="true"></span><span id="wake-lock-text">wake lock: inactive</span></span>
      <span class="badge" id="bridge-health-indicator" data-testid="lets-talk-bridge-health" data-state="degraded"><span class="dot" aria-hidden="true"></span><span id="bridge-health-text">bridge: checking</span></span>
      <span class="badge" id="pwa-install-indicator" data-testid="lets-talk-pwa-install-indicator" data-state="inactive"><span class="dot" aria-hidden="true"></span><span id="pwa-install-text">install: checking</span></span>
    </div>
  </div>
</header>
<main>
  <p class="state" id="state" data-testid="lets-talk-state" data-phase="ready">ready</p>
  <label class="hands-free" id="hands-free-label">
    <input type="checkbox" id="hands-free" data-testid="lets-talk-hands-free" />
    Hands-free
  </label>
  <label class="hands-free" id="mute-label">
    <input type="checkbox" id="mute" data-testid="lets-talk-mute" />
    Mute voice playback
  </label>
  <label class="hands-free" id="wake-lock-label">
    <input type="checkbox" id="wake-lock-toggle" data-testid="lets-talk-wake-lock-toggle" />
    Keep screen awake
  </label>
  <label class="hands-free" id="hold-music-label">
    <input type="checkbox" id="hold-music-toggle" data-testid="lets-talk-hold-music" checked />
    Hold music
  </label>
  <span class="hold-music-title" id="hold-music-title" data-testid="lets-talk-hold-music-title" hidden></span>
  <button type="button" class="record" id="record" data-testid="lets-talk-record" aria-pressed="false">Record</button>
  <button type="button" class="secondary warn" id="pause-all" data-testid="lets-talk-pause-all" aria-pressed="false">Pause all</button>
  <button type="button" class="secondary" id="pwa-install" data-testid="lets-talk-pwa-install">Install app</button>
  <button type="button" class="secondary" id="new-session" data-testid="lets-talk-new-session">New session</button>
  <p class="transcript" id="transcript" data-testid="lets-talk-transcript" hidden></p>
  <p class="error" id="error" data-testid="lets-talk-error" hidden></p>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var AUTH_STORAGE_KEY = 'lets-talk-bearer';
  function readAuthCookie() {
    try {
      var match = document.cookie.match(/(?:^|;\\s*)lets-talk-bearer=([^;]*)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }
  function writeAuthCookie(value) {
    try {
      var maxAge = 60 * 60 * 24 * 400;
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = AUTH_STORAGE_KEY + '=' + encodeURIComponent(value)
        + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure;
    } catch (_) {}
  }
  function persistAuthToken(value) {
    if (!value) {
      return;
    }
    try { localStorage.setItem(AUTH_STORAGE_KEY, value); } catch (_) {}
    writeAuthCookie(value);
  }
  var token = params.get('bearer') || params.get('token') || '';
  if (token) {
    persistAuthToken(token);
  } else {
    try { token = localStorage.getItem(AUTH_STORAGE_KEY) || ''; } catch (_) { token = ''; }
    if (!token) {
      token = readAuthCookie();
    }
    if (token) {
      persistAuthToken(token);
    }
  }
  var q = token ? ('?bearer=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;
  // Point the install manifest at a start_url that includes the bearer so
  // the home-screen icon launches already signed in.
  var manifestEl = document.getElementById('lets-talk-manifest');
  if (manifestEl) {
    manifestEl.setAttribute('href', '/lets-talk/manifest.json' + q);
  }
  if (token && !params.get('bearer') && !params.get('token')) {
    try {
      var nextUrl = location.pathname + q + location.hash;
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', nextUrl);
      }
    } catch (_) {}
  }

  var STT_RETRY_BUDGET = 3;
  var DEFAULT_SPEECH_LOCALE = ${JSON.stringify(speechLocale)};
  var HANDS_FREE_STORAGE_KEY = ${JSON.stringify(LETS_TALK_HANDS_FREE_STORAGE_KEY)};
  var MUTE_STORAGE_KEY = 'lets-talk-muted';
  var WAKE_LOCK_STORAGE_KEY = 'lets-talk-wake-lock-enabled';
  var HANDS_FREE_SILENCE_MS = ${LETS_TALK_HANDS_FREE_SILENCE_MS};
  var HANDS_FREE_POST_SPEECH_MS = ${LETS_TALK_HANDS_FREE_POST_SPEECH_MS};
  var HANDS_FREE_AFTER_ERROR_MS = Math.max(HANDS_FREE_POST_SPEECH_MS, 2500);
  var HANDS_FREE_MAX_LISTEN_MS = ${LETS_TALK_HANDS_FREE_MAX_LISTEN_MS};
  var SPEECH_LEVEL_THRESHOLD = ${LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD};
  var stateEl = document.getElementById('state');
  var recordBtn = document.getElementById('record');
  var handsFreeEl = document.getElementById('hands-free');
  var muteEl = document.getElementById('mute');
  var wakeLockToggleEl = document.getElementById('wake-lock-toggle');
  var pauseAllBtn = document.getElementById('pause-all');
  var newSessionBtn = document.getElementById('new-session');
  var transcriptEl = document.getElementById('transcript');
  var errorEl = document.getElementById('error');
  var wakeLockIndicatorEl = document.getElementById('wake-lock-indicator');
  var wakeLockTextEl = document.getElementById('wake-lock-text');
  var bridgeHealthIndicatorEl = document.getElementById('bridge-health-indicator');
  var bridgeHealthTextEl = document.getElementById('bridge-health-text');

  var phase = 'ready';
  var recording = false;
  var handsFreeEnabled = localStorage.getItem(HANDS_FREE_STORAGE_KEY) === '1';
  var muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  var wakeLockEnabled = localStorage.getItem(WAKE_LOCK_STORAGE_KEY) !== '0';
  var pausedAll = false;
  var mediaRecorder = null;
  var recordStream = null;
  var chunks = [];
  var playbackAudio = null;
  var recordMimeType = '';
  var recordStartedAt = 0;
  var speechDetected = false;
  var lastSoundAt = 0;
  var silenceCheckTimer = null;
  var autoListenTimer = null;
  var audioContext = null;
  var analyserNode = null;
  var analyserBuffer = null;
  var wakeLockSentinel = null;
  var bridgeHealthTimer = null;
  var bridgeHealthAgeTimer = null;
  var bridgeHealthInFlight = false;
  var bridgeLastOkAt = 0;
  var bridgeLastState = 'degraded';
  var lastRecordingStopReason = '';
  var MIN_RECORD_MS = 400;
  var RECORDER_MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];

  // ── Chiptune elevator music (Game Boy style Zappa arrangements) ──
  // Two pulse channels + one triangle (bass) + noise (drums), all via Web Audio API.
  // Plays a random song when the phase enters "thinking"; fades out on exit.
  var chiptuneCtx = null;
  var chiptuneGain = null;
  var chiptuneOscs = [];
  var chiptuneNoiseNode = null;
  var chiptuneTimer = null;
  var chiptuneStep = 0;
  var chiptuneNextAt = 0;
  var chiptuneSongIdx = -1;
  var chiptuneGeneration = 0;
  var chiptuneStorageKey = 'lets-talk-holdmusic';
  var holdMusicEnabled = localStorage.getItem(chiptuneStorageKey) !== '0';

  // Note frequency helper: A4 = 440
  function n(semitone) { return 440 * Math.pow(2, (semitone - 69) / 12); }
  // MIDI note names for readability
  var C3=48,D3=50,Eb3=51,E3=52,F3=53,Fs3=54,G3=55,Ab3=56,A3=57,Bb3=58,B3=59;
  var C4=60,D4=62,Eb4=63,E4=64,F4=65,Fs4=66,G4=67,Ab4=68,A4=69,Bb4=70,B4=71;
  var C5=72,D5=74,Eb5=75,E5=76,F5=77,Fs5=78,G5=79,Ab5=80,A5=81,Bb5=82,B5=83;
  var C6=84,D6=86,Eb6=87,E6=88;
  var R=0; // rest

  // Each song: { name, bpm, steps: [[pulse1, pulse2, triangle, hat]] }
  // hat: 1 = closed hi-hat tick, 2 = snare-ish noise burst, 0 = silent
  var chiptuneSongs = [
    // 1. Peaches en Regalia
    { name: 'Peaches en Regalia', bpm: 138, steps: [
      [E5,G4,C3,1],[G5,B4,C3,0],[A5,C5,E3,1],[G5,B4,E3,0],
      [F5,A4,F3,1],[E5,G4,F3,0],[D5,F4,G3,2],[C5,E4,G3,0],
      [E5,G4,A3,1],[G5,B4,A3,0],[A5,C5,F3,1],[B5,D5,F3,0],
      [C6,E5,C3,1],[B5,D5,C3,0],[A5,C5,G3,2],[G5,B4,G3,0],
      [F5,A4,Bb3,1],[E5,Ab4,Bb3,0],[F5,A4,F3,1],[Ab5,C5,F3,0],
      [G5,Bb4,Eb3,1],[F5,Ab4,Eb3,0],[Eb5,G4,Bb3,2],[D5,F4,Bb3,0],
      [E5,G4,C3,1],[D5,F4,C3,0],[E5,G4,G3,1],[G5,B4,G3,0],
      [A5,C5,F3,1],[G5,Bb4,F3,0],[F5,A4,C3,2],[E5,G4,C3,0],
    ]},
    // 2. Cosmik Debris
    { name: 'Cosmik Debris', bpm: 112, steps: [
      [E4,R,E3,1],[R,R,E3,0],[G4,B3,G3,1],[A4,C4,G3,0],
      [B4,E4,A3,2],[A4,C4,A3,0],[G4,B3,E3,1],[R,R,E3,0],
      [E4,G3,C3,1],[G4,B3,C3,0],[A4,C4,D3,1],[B4,D4,D3,2],
      [C5,E4,A3,1],[B4,D4,A3,0],[A4,C4,E3,1],[G4,B3,E3,0],
      [E5,G4,E3,1],[D5,Fs4,E3,0],[E5,G4,A3,1],[R,R,A3,2],
      [B4,E4,B3,1],[A4,C4,B3,0],[G4,B3,E3,1],[Fs4,A3,E3,0],
      [E4,G3,A3,1],[R,R,A3,0],[G4,B3,E3,2],[A4,C4,E3,0],
      [B4,D4,G3,1],[C5,E4,G3,0],[B4,D4,E3,1],[A4,C4,E3,2],
    ]},
    // 3. Muffin Man
    { name: 'Muffin Man', bpm: 120, steps: [
      [A4,E4,A3,1],[R,R,A3,0],[A4,E4,E3,1],[B4,Fs4,E3,2],
      [C5,G4,F3,1],[B4,Fs4,F3,0],[A4,E4,C3,1],[R,R,C3,0],
      [G4,D4,G3,1],[A4,E4,G3,0],[B4,Fs4,D3,2],[C5,G4,D3,0],
      [D5,A4,G3,1],[C5,G4,G3,0],[B4,Fs4,A3,1],[A4,E4,A3,0],
      [E5,B4,A3,1],[D5,A4,A3,0],[C5,G4,F3,2],[B4,Fs4,F3,0],
      [A4,E4,E3,1],[R,R,E3,0],[G4,D4,A3,1],[A4,E4,A3,2],
      [B4,Fs4,B3,1],[C5,G4,B3,0],[D5,A4,G3,1],[C5,G4,G3,0],
      [B4,Fs4,E3,2],[A4,E4,E3,0],[G4,D4,A3,1],[A4,E4,A3,0],
    ]},
    // 4. Montana
    { name: 'Montana', bpm: 126, steps: [
      [B4,Fs4,B3,1],[D5,A4,B3,0],[E5,B4,E3,1],[D5,A4,E3,2],
      [B4,Fs4,Fs3,1],[A4,E4,Fs3,0],[B4,Fs4,B3,1],[R,R,B3,0],
      [Fs5,D5,D3,1],[E5,B4,D3,0],[D5,A4,A3,2],[B4,Fs4,A3,0],
      [A4,E4,E3,1],[B4,Fs4,E3,0],[D5,A4,B3,1],[E5,B4,B3,0],
      [Fs5,D5,Fs3,1],[E5,B4,Fs3,0],[D5,A4,D3,2],[E5,B4,D3,0],
      [Fs5,D5,A3,1],[R,R,A3,0],[E5,B4,E3,1],[D5,A4,E3,2],
      [B4,Fs4,B3,1],[A4,E4,B3,0],[Fs4,D4,Fs3,1],[A4,E4,Fs3,0],
      [B4,Fs4,B3,2],[D5,A4,B3,0],[E5,B4,E3,1],[Fs5,D5,E3,0],
    ]},
    // 5. Willie the Pimp
    { name: 'Willie the Pimp', bpm: 108, steps: [
      [A4,E4,A3,1],[C5,G4,A3,0],[D5,A4,D3,2],[C5,G4,D3,0],
      [A4,E4,A3,1],[R,R,A3,0],[G4,D4,E3,1],[A4,E4,E3,0],
      [C5,G4,F3,1],[D5,A4,F3,2],[E5,B4,A3,1],[D5,A4,A3,0],
      [C5,G4,G3,1],[A4,E4,G3,0],[G4,D4,D3,2],[A4,E4,D3,0],
      [E5,C5,A3,1],[D5,A4,A3,0],[C5,G4,E3,1],[D5,A4,E3,2],
      [E5,B4,F3,1],[R,R,F3,0],[D5,A4,D3,1],[C5,G4,D3,0],
      [A4,E4,A3,2],[G4,D4,A3,0],[A4,E4,E3,1],[C5,G4,E3,0],
      [D5,A4,A3,1],[E5,B4,A3,0],[D5,A4,D3,2],[C5,G4,D3,0],
    ]},
    // 6. Inca Roads
    { name: 'Inca Roads', bpm: 132, steps: [
      [E5,B4,E3,1],[Fs5,D5,E3,0],[G5,E5,A3,1],[Fs5,D5,A3,2],
      [E5,B4,B3,1],[D5,A4,B3,0],[B4,Fs4,E3,1],[R,R,E3,0],
      [D5,A4,D3,1],[E5,B4,D3,0],[Fs5,D5,G3,2],[E5,B4,G3,0],
      [D5,A4,A3,1],[B4,Fs4,A3,0],[A4,E4,E3,1],[B4,Fs4,E3,0],
      [E5,B4,C3,1],[G5,E5,C3,0],[Fs5,D5,G3,2],[E5,B4,G3,0],
      [D5,A4,D3,1],[E5,B4,D3,0],[Fs5,D5,A3,1],[R,R,A3,0],
      [G5,E5,E3,1],[Fs5,D5,E3,2],[E5,B4,B3,1],[D5,A4,B3,0],
      [B4,Fs4,E3,1],[D5,A4,E3,0],[E5,B4,A3,2],[Fs5,D5,A3,0],
    ]},
    // 7. Zomby Woof
    { name: 'Zomby Woof', bpm: 140, steps: [
      [E4,B3,E3,1],[G4,D4,E3,0],[A4,E4,A3,2],[Bb4,F4,A3,0],
      [C5,G4,C3,1],[Bb4,F4,C3,0],[A4,E4,G3,1],[G4,D4,G3,0],
      [E4,B3,E3,2],[R,R,E3,0],[G4,D4,Bb3,1],[A4,E4,Bb3,0],
      [Bb4,F4,F3,1],[C5,G4,F3,2],[D5,A4,Bb3,1],[C5,G4,Bb3,0],
      [Bb4,F4,G3,1],[A4,E4,G3,0],[G4,D4,E3,2],[A4,E4,E3,0],
      [Bb4,F4,Bb3,1],[C5,G4,Bb3,0],[D5,A4,F3,1],[Eb5,Bb4,F3,2],
      [D5,A4,G3,1],[C5,G4,G3,0],[Bb4,F4,E3,1],[A4,E4,E3,0],
      [G4,D4,C3,2],[A4,E4,C3,0],[Bb4,F4,G3,1],[C5,G4,G3,0],
    ]},
    // 8. City of Tiny Lites
    { name: 'City of Tiny Lites', bpm: 118, steps: [
      [Fs4,D4,D3,1],[A4,Fs4,D3,0],[B4,G4,G3,1],[A4,Fs4,G3,2],
      [Fs4,D4,A3,1],[E4,C4,A3,0],[D4,A3,D3,1],[R,R,D3,0],
      [Fs4,D4,Fs3,1],[A4,Fs4,Fs3,0],[B4,G4,B3,2],[C5,A4,B3,0],
      [D5,B4,D3,1],[C5,A4,D3,0],[B4,G4,G3,1],[A4,Fs4,G3,0],
      [Fs5,D5,D3,1],[E5,C5,D3,2],[D5,B4,A3,1],[C5,A4,A3,0],
      [B4,G4,E3,1],[A4,Fs4,E3,0],[Fs4,D4,D3,2],[E4,C4,D3,0],
      [D4,A3,A3,1],[Fs4,D4,A3,0],[A4,Fs4,D3,1],[B4,G4,D3,2],
      [C5,A4,G3,1],[B4,G4,G3,0],[A4,Fs4,D3,1],[Fs4,D4,D3,0],
    ]},
    // 9. Camarillo Brillo
    { name: 'Camarillo Brillo', bpm: 116, steps: [
      [D5,A4,D3,1],[C5,G4,D3,0],[A4,E4,A3,1],[G4,D4,A3,2],
      [F4,C4,F3,1],[G4,D4,F3,0],[A4,E4,C3,1],[R,R,C3,0],
      [Bb4,F4,Bb3,1],[A4,E4,Bb3,0],[G4,D4,F3,2],[F4,C4,F3,0],
      [E4,B3,C3,1],[F4,C4,C3,0],[G4,D4,G3,1],[A4,E4,G3,0],
      [D5,A4,D3,1],[E5,B4,D3,2],[F5,C5,F3,1],[E5,B4,F3,0],
      [D5,A4,Bb3,1],[C5,G4,Bb3,0],[Bb4,F4,F3,1],[A4,E4,F3,2],
      [G4,D4,C3,1],[A4,E4,C3,0],[Bb4,F4,G3,1],[C5,G4,G3,0],
      [D5,A4,D3,2],[C5,G4,D3,0],[A4,E4,A3,1],[G4,D4,A3,0],
    ]},
    // 10. Black Napkins
    { name: 'Black Napkins', bpm: 100, steps: [
      [G4,D4,G3,1],[Bb4,F4,G3,0],[C5,G4,C3,1],[Bb4,F4,C3,2],
      [G4,D4,Eb3,1],[F4,C4,Eb3,0],[Eb4,Bb3,Bb3,1],[R,R,Bb3,0],
      [F4,C4,F3,1],[G4,D4,F3,0],[Bb4,F4,Bb3,2],[C5,G4,Bb3,0],
      [D5,A4,G3,1],[C5,G4,G3,0],[Bb4,F4,D3,1],[G4,D4,D3,0],
      [F5,C5,Eb3,1],[Eb5,Bb4,Eb3,0],[D5,A4,Bb3,2],[C5,G4,Bb3,0],
      [Bb4,F4,F3,1],[G4,D4,F3,0],[F4,C4,C3,1],[Eb4,Bb3,C3,2],
      [D4,A3,G3,1],[Eb4,Bb3,G3,0],[F4,C4,Bb3,1],[G4,D4,Bb3,0],
      [Bb4,F4,Eb3,2],[C5,G4,Eb3,0],[D5,A4,G3,1],[C5,G4,G3,0],
    ]},
    // 11. Watermelon in Easter Hay
    { name: 'Watermelon in Easter Hay', bpm: 72, steps: [
      [E5,B4,E3,1],[R,R,E3,0],[D5,A4,A3,1],[R,R,A3,0],
      [B4,Fs4,B3,2],[R,R,B3,0],[A4,E4,E3,1],[R,R,E3,0],
      [G4,D4,C3,1],[R,R,C3,0],[A4,E4,D3,1],[R,R,D3,2],
      [B4,Fs4,E3,1],[R,R,E3,0],[D5,A4,A3,1],[R,R,A3,0],
      [E5,B4,E3,1],[R,R,E3,0],[Fs5,D5,Fs3,2],[R,R,Fs3,0],
      [E5,B4,A3,1],[R,R,A3,0],[D5,A4,B3,1],[R,R,B3,0],
      [B4,Fs4,E3,2],[R,R,E3,0],[A4,E4,A3,1],[R,R,A3,0],
      [G4,D4,G3,1],[R,R,G3,0],[A4,E4,E3,2],[B4,Fs4,E3,0],
    ]},
    // 12. Apostrophe
    { name: "Apostrophe (')", bpm: 144, steps: [
      [A4,E4,A3,1],[C5,G4,A3,0],[E5,B4,C3,2],[C5,G4,C3,0],
      [A4,E4,E3,1],[G4,D4,E3,0],[E4,B3,A3,1],[G4,D4,A3,0],
      [A4,E4,D3,2],[C5,G4,D3,0],[D5,A4,A3,1],[C5,G4,A3,0],
      [A4,E4,F3,1],[G4,D4,F3,0],[A4,E4,C3,2],[R,R,C3,0],
      [C5,G4,A3,1],[D5,A4,A3,0],[E5,B4,E3,2],[D5,A4,E3,0],
      [C5,G4,G3,1],[A4,E4,G3,0],[G4,D4,D3,1],[A4,E4,D3,0],
      [C5,G4,A3,2],[E5,B4,A3,0],[D5,A4,F3,1],[C5,G4,F3,0],
      [A4,E4,E3,1],[G4,D4,E3,0],[A4,E4,A3,2],[C5,G4,A3,0],
    ]},
  ];

  function createChiptuneOsc(ctx, type, freq, gain, dest) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq || 440;
    g.gain.value = gain || 0;
    osc.connect(g);
    g.connect(dest);
    osc.start();
    return { osc: osc, gain: g };
  }

  function startChiptune() {
    if (!holdMusicEnabled || pausedAll || phase !== 'thinking') return;
    stopChiptune();
    var generation = ++chiptuneGeneration;
    try {
      chiptuneCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    if (chiptuneCtx.state === 'suspended') {
      chiptuneCtx.resume().catch(function () {});
    }
    chiptuneGain = chiptuneCtx.createGain();
    chiptuneGain.gain.value = 0.015;
    chiptuneGain.connect(chiptuneCtx.destination);

    // Pick a random song different from the last one
    var idx;
    do { idx = Math.floor(Math.random() * chiptuneSongs.length); }
    while (chiptuneSongs.length > 1 && idx === chiptuneSongIdx);
    chiptuneSongIdx = idx;
    var song = chiptuneSongs[idx];
    chiptuneStep = 0;
    var titleEl = document.getElementById('hold-music-title');
    if (titleEl) { titleEl.textContent = '\u266B ' + song.name; titleEl.hidden = false; }

    // Pulse 1 (lead), Pulse 2 (harmony), Triangle (bass)
    var p1 = createChiptuneOsc(chiptuneCtx, 'square', 440, 0, chiptuneGain);
    var p2 = createChiptuneOsc(chiptuneCtx, 'square', 440, 0, chiptuneGain);
    var tri = createChiptuneOsc(chiptuneCtx, 'triangle', 110, 0.5, chiptuneGain);
    chiptuneOscs = [p1, p2, tri];

    var noiseGain = chiptuneCtx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.connect(chiptuneGain);
    try {
      var bufSize = chiptuneCtx.sampleRate;
      var noiseBuf = chiptuneCtx.createBuffer(1, bufSize, chiptuneCtx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      chiptuneNoiseNode = chiptuneCtx.createBufferSource();
      chiptuneNoiseNode.buffer = noiseBuf;
      chiptuneNoiseNode.loop = true;
      chiptuneNoiseNode.connect(noiseGain);
      chiptuneNoiseNode.start();
    } catch (e) { chiptuneNoiseNode = null; }

    var stepMs = 60000 / song.bpm / 2;
    var stepSec = stepMs / 1000;
    var lookaheadSec = 0.12;

    function scheduleChiptuneStep(atTime) {
      if (generation !== chiptuneGeneration || !chiptuneCtx) {
        return;
      }
      var s = song.steps[chiptuneStep % song.steps.length];
      var glide = 0.02;

      if (s[0] === R) {
        p1.gain.gain.setTargetAtTime(0, atTime, 0.005);
      } else {
        p1.osc.frequency.setTargetAtTime(n(s[0]), atTime, glide);
        p1.gain.gain.setTargetAtTime(0.3, atTime, 0.005);
      }
      if (s[1] === R) {
        p2.gain.gain.setTargetAtTime(0, atTime, 0.005);
      } else {
        p2.osc.frequency.setTargetAtTime(n(s[1]), atTime, glide);
        p2.gain.gain.setTargetAtTime(0.2, atTime, 0.005);
      }
      tri.osc.frequency.setTargetAtTime(n(s[2]), atTime, glide);

      if (chiptuneNoiseNode) {
        if (s[3] === 1) {
          noiseGain.gain.setValueAtTime(0.15, atTime);
          noiseGain.gain.setTargetAtTime(0, atTime + 0.03, 0.01);
        } else if (s[3] === 2) {
          noiseGain.gain.setValueAtTime(0.25, atTime);
          noiseGain.gain.setTargetAtTime(0, atTime + 0.08, 0.03);
        }
      }

      chiptuneStep++;
    }

    // Queue the first notes on the audio clock to avoid JS timer startup gaps.
    chiptuneNextAt = chiptuneCtx.currentTime + 0.02;
    while (chiptuneNextAt < chiptuneCtx.currentTime + lookaheadSec) {
      scheduleChiptuneStep(chiptuneNextAt);
      chiptuneNextAt += stepSec;
    }
    chiptuneTimer = setInterval(function () {
      if (generation !== chiptuneGeneration || !chiptuneCtx || phase !== 'thinking') {
        return;
      }
      while (chiptuneNextAt < chiptuneCtx.currentTime + lookaheadSec) {
        scheduleChiptuneStep(chiptuneNextAt);
        chiptuneNextAt += stepSec;
      }
    }, 50);
  }

  function stopChiptune() {
    chiptuneGeneration++;
    if (chiptuneTimer) {
      clearInterval(chiptuneTimer);
      chiptuneTimer = null;
    }
    if (chiptuneGain && chiptuneCtx) {
      try { chiptuneGain.gain.setValueAtTime(0, chiptuneCtx.currentTime); } catch (e) {}
    }
    for (var i = 0; i < chiptuneOscs.length; i++) {
      try { chiptuneOscs[i].osc.stop(); } catch (e) {}
    }
    chiptuneOscs = [];
    if (chiptuneNoiseNode) {
      try { chiptuneNoiseNode.stop(); } catch (e) {}
      chiptuneNoiseNode = null;
    }
    if (chiptuneCtx) {
      chiptuneCtx.close().catch(function () {});
      chiptuneCtx = null;
    }
    var titleEl = document.getElementById('hold-music-title');
    if (titleEl) { titleEl.hidden = true; }
    chiptuneGain = null;
    chiptuneStep = 0;
    chiptuneNextAt = 0;
  }

  function stopPlaybackNow() {
    if (playbackAudio) {
      playbackAudio.pause();
      playbackAudio = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function pickRecorderMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return 'audio/webm';
    }
    for (var i = 0; i < RECORDER_MIME_CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(RECORDER_MIME_CANDIDATES[i])) {
        return RECORDER_MIME_CANDIDATES[i];
      }
    }
    return '';
  }

  function finalizeRecording() {
    if (recordStream) {
      recordStream.getTracks().forEach(function (t) { t.stop(); });
      recordStream = null;
    }
    var blobType = recordMimeType || 'audio/webm';
    var blob = new Blob(chunks, { type: blobType });
    chunks = [];
    recordMimeType = '';
    if (blob.size > 0) {
      endTurn(blob, blobType);
      return;
    }
    if (lastRecordingStopReason === 'no-speech') {
      lastRecordingStopReason = '';
      showError('No speech detected — try again.');
    } else {
      showError('No audio was captured — try speaking a bit longer before stopping.');
    }
    setPhase('ready');
    scheduleHandsFreeListen();
  }

  function setPhase(next) {
    var prev = phase;
    phase = next;
    stateEl.textContent = next;
    stateEl.setAttribute('data-phase', next);
    var busy = next === 'thinking' || next === 'speaking';
    recordBtn.disabled = busy || pausedAll;
    newSessionBtn.disabled = busy;
    handsFreeEl.disabled = busy || pausedAll;
    muteEl.disabled = pausedAll;
    if (next === 'thinking' && prev !== 'thinking') {
      startChiptune();
    } else if (next !== 'thinking') {
      stopChiptune();
    }
  }

  function parseHandsFreeEnabled(raw) {
    return raw === '1' || raw === 'true';
  }

  function clearAutoListenTimer() {
    if (autoListenTimer) {
      clearTimeout(autoListenTimer);
      autoListenTimer = null;
    }
  }

  function scheduleHandsFreeListen(delayMs) {
    clearAutoListenTimer();
    if (pausedAll || !handsFreeEnabled || phase !== 'ready' || recording) {
      return;
    }
    var waitMs = typeof delayMs === 'number' ? delayMs : HANDS_FREE_POST_SPEECH_MS;
    autoListenTimer = setTimeout(function () {
      autoListenTimer = null;
      if (handsFreeEnabled && phase === 'ready' && !recording) {
        startRecording(true);
      }
    }, waitMs);
  }

  function stopSilenceMonitor() {
    if (silenceCheckTimer) {
      clearInterval(silenceCheckTimer);
      silenceCheckTimer = null;
    }
    if (audioContext) {
      audioContext.close().catch(function () {});
      audioContext = null;
    }
    analyserNode = null;
    analyserBuffer = null;
  }

  function readRecordingRms() {
    if (!analyserNode || !analyserBuffer) {
      return 0;
    }
    analyserNode.getByteTimeDomainData(analyserBuffer);
    var sum = 0;
    for (var i = 0; i < analyserBuffer.length; i++) {
      var sample = (analyserBuffer[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / analyserBuffer.length);
  }

  function startSilenceMonitor(stream) {
    stopSilenceMonitor();
    speechDetected = false;
    lastSoundAt = Date.now();
    if (!handsFreeEnabled || !window.AudioContext) {
      return;
    }
    audioContext = new AudioContext();
    var source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserBuffer = new Uint8Array(analyserNode.fftSize);
    source.connect(analyserNode);
    silenceCheckTimer = setInterval(function () {
      if (!recording) {
        return;
      }
      var now = Date.now();
      var recordingMs = now - recordStartedAt;
      var rms = readRecordingRms();
      if (rms >= SPEECH_LEVEL_THRESHOLD) {
        speechDetected = true;
        lastSoundAt = now;
      }
      if (!speechDetected && recordingMs >= HANDS_FREE_MAX_LISTEN_MS) {
        lastRecordingStopReason = 'no-speech';
        stopRecording(false);
        return;
      }
      if (
        speechDetected &&
        recordingMs >= MIN_RECORD_MS &&
        now - lastSoundAt >= HANDS_FREE_SILENCE_MS
      ) {
        stopRecording(false);
      }
    }, 100);
  }

  function updateRecordButton() {
    if (recording) {
      recordBtn.setAttribute('aria-pressed', 'true');
      recordBtn.textContent = handsFreeEnabled ? 'Listening' : 'Stop';
      return;
    }
    recordBtn.setAttribute('aria-pressed', 'false');
    recordBtn.textContent = 'Record';
  }

  function setPauseAll(nextPaused) {
    pausedAll = !!nextPaused;
    pauseAllBtn.setAttribute('aria-pressed', pausedAll ? 'true' : 'false');
    pauseAllBtn.textContent = pausedAll ? 'Resume' : 'Pause all';
    if (pausedAll) {
      muted = true;
      muteEl.checked = true;
      localStorage.setItem(MUTE_STORAGE_KEY, '1');
      handsFreeEnabled = false;
      handsFreeEl.checked = false;
      localStorage.setItem(HANDS_FREE_STORAGE_KEY, '0');
      clearAutoListenTimer();
      if (recording) {
        stopRecording(false);
      }
      stopPlaybackNow();
      stopChiptune();
    } else if (phase === 'thinking' && holdMusicEnabled) {
      startChiptune();
    }
    muteEl.disabled = pausedAll;
    handsFreeEl.disabled = pausedAll || (phase === 'thinking' || phase === 'speaking');
    recordBtn.disabled = pausedAll || (phase === 'thinking' || phase === 'speaking');
  }

  function setWakeLockState(state, text) {
    wakeLockIndicatorEl.setAttribute('data-state', state);
    wakeLockTextEl.textContent = text;
  }

  function setBridgeHealthState(state, text) {
    bridgeLastState = state;
    document.body.setAttribute('data-bridge-state', state);
    bridgeHealthIndicatorEl.setAttribute('data-state', state);
    bridgeHealthTextEl.textContent = text;
  }

  function heartbeatTextFor(state) {
    if (state === 'healthy') {
      return 'bridge: healthy';
    }
    if (state === 'down') {
      return 'bridge: down';
    }
    return 'bridge: degraded';
  }

  function updateBridgeHealthFromAge() {
    if (!bridgeLastOkAt) {
      setBridgeHealthState('degraded', 'bridge: checking');
      return;
    }
    var ageMs = Date.now() - bridgeLastOkAt;
    if (bridgeLastState === 'down') {
      return;
    }
    if (ageMs <= 10000) {
      setBridgeHealthState('healthy', heartbeatTextFor('healthy'));
      return;
    }
    if (ageMs <= 25000) {
      setBridgeHealthState('degraded', heartbeatTextFor('degraded'));
      return;
    }
    setBridgeHealthState('down', heartbeatTextFor('down'));
  }

  async function pollBridgeHealth() {
    if (bridgeHealthInFlight) {
      return;
    }
    bridgeHealthInFlight = true;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) {
        controller.abort();
      }
    }, 2500);
    try {
      var res = await fetch('/lets-talk' + q, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      if (res.ok) {
        bridgeLastOkAt = Date.now();
        setBridgeHealthState('healthy', heartbeatTextFor('healthy'));
      } else if (bridgeLastOkAt > 0 && (Date.now() - bridgeLastOkAt) <= 25000) {
        setBridgeHealthState('degraded', heartbeatTextFor('degraded'));
      } else {
        setBridgeHealthState('down', heartbeatTextFor('down'));
      }
    } catch {
      if (bridgeLastOkAt > 0 && (Date.now() - bridgeLastOkAt) <= 25000) {
        setBridgeHealthState('degraded', heartbeatTextFor('degraded'));
      } else {
        setBridgeHealthState('down', heartbeatTextFor('down'));
      }
    } finally {
      clearTimeout(timeout);
      bridgeHealthInFlight = false;
    }
  }

  async function requestScreenWakeLock() {
    if (!wakeLockEnabled) {
      setWakeLockState('inactive', 'wake lock: off');
      return;
    }
    if (wakeLockSentinel) {
      setWakeLockState('active', 'wake lock: active');
      return;
    }
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      setWakeLockState('unsupported', 'wake lock: unsupported');
      return;
    }
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      setWakeLockState('active', 'wake lock: active');
      if (wakeLockSentinel && typeof wakeLockSentinel.addEventListener === 'function') {
        wakeLockSentinel.addEventListener('release', function () {
          wakeLockSentinel = null;
          setWakeLockState('inactive', 'wake lock: inactive');
        });
      }
    } catch {
      wakeLockSentinel = null;
      setWakeLockState('error', 'wake lock: blocked');
    }
  }

  function releaseScreenWakeLock() {
    if (!wakeLockSentinel || typeof wakeLockSentinel.release !== 'function') {
      wakeLockSentinel = null;
      if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
        setWakeLockState('inactive', wakeLockEnabled ? 'wake lock: inactive' : 'wake lock: off');
      }
      return;
    }
    wakeLockSentinel.release().catch(function () {});
    wakeLockSentinel = null;
    setWakeLockState('inactive', wakeLockEnabled ? 'wake lock: inactive' : 'wake lock: off');
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function controlAuthHeaders() {
    if (!token) {
      return { 'content-type': 'application/json' };
    }
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      'x-control-token': token,
    };
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var dataUrl = String(reader.result || '');
        var comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function playReplyAudio(base64, mimeType) {
    return new Promise(function (resolve, reject) {
      stopPlaybackNow();
      playbackAudio = new Audio('data:' + (mimeType || 'audio/ogg') + ';base64,' + base64);
      playbackAudio.onended = function () { resolve(); };
      playbackAudio.onerror = function () { reject(new Error('playback failed')); };
      playbackAudio.play().catch(reject);
    });
  }

  function pickSpeechVoice(locale) {
    if (!window.speechSynthesis || !window.speechSynthesis.getVoices) {
      return null;
    }
    var voices = window.speechSynthesis.getVoices();
    var prefix = String(locale || '').split('-')[0].toLowerCase();
    for (var i = 0; i < voices.length; i++) {
      var lang = (voices[i].lang || '').toLowerCase();
      if (lang === String(locale || '').toLowerCase() || lang.startsWith(prefix)) {
        return voices[i];
      }
    }
    return null;
  }

  function ensureSpeechVoices() {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis || !window.speechSynthesis.getVoices) {
        resolve();
        return;
      }
      var voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        resolve();
        return;
      }
      var done = false;
      function finish() {
        if (done) {
          return;
        }
        done = true;
        resolve();
      }
      window.speechSynthesis.onvoiceschanged = finish;
      setTimeout(finish, 250);
    });
  }

  function speakReplyText(text, locale) {
    return ensureSpeechVoices().then(function () {
      return new Promise(function (resolve, reject) {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
          reject(new Error('Text-to-speech is not available in this browser.'));
          return;
        }
        window.speechSynthesis.cancel();
        var utter = new SpeechSynthesisUtterance(text);
        var speechLocale = locale || DEFAULT_SPEECH_LOCALE;
        utter.lang = speechLocale;
        var voice = pickSpeechVoice(speechLocale);
        if (voice) {
          utter.voice = voice;
        }
        utter.onend = function () { resolve(); };
        utter.onerror = function (ev) {
          reject(new Error((ev && ev.error) ? String(ev.error) : 'speech synthesis failed'));
        };
        window.speechSynthesis.speak(utter);
      });
    });
  }

  async function submitTurn(body, sttAttempt) {
    var res = await fetch('/lets-talk/turn' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify(body),
    });
    var payload = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Not signed in — open Lets Talk from the console menu once, then reopen this app.');
      }
      throw new Error(payload && payload.reason ? String(payload.reason) : ('HTTP ' + res.status));
    }
    if (payload && payload.success) {
      return payload;
    }
    if (payload && payload.recoverable && payload.state === 'error' && sttAttempt + 1 < STT_RETRY_BUDGET) {
      // Stay in thinking so hold music does not restart on every STT retry.
      return submitTurn(body, sttAttempt + 1);
    }
    if (payload && payload.recoverable) {
      throw new Error(payload.reason || 'turn failed');
    }
    throw new Error(payload && payload.reason ? String(payload.reason) : 'turn failed');
  }

  async function endTurn(blob, mimeType) {
    clearAutoListenTimer();
    setPhase('thinking');
    showError('');
    try {
      if (!token) {
        throw new Error('Not signed in — open Lets Talk from the console once, then reopen the installed app.');
      }
      var audioBase64 = await blobToBase64(blob);
      var result = await submitTurn({ audioBase64: audioBase64, mimeType: mimeType }, 0);
      setBridgeHealthState('healthy', heartbeatTextFor('healthy'));
      transcriptEl.hidden = false;
      transcriptEl.textContent = result.replyText || result.transcript || '';
      setPhase('speaking');
      if (muted) {
        stopPlaybackNow();
      } else if (result.replyAudioBase64) {
        await playReplyAudio(result.replyAudioBase64, 'audio/ogg');
      } else if (result.replySpeechText || result.replyText) {
        await speakReplyText(result.replySpeechText || result.replyText, result.speechLocale || DEFAULT_SPEECH_LOCALE);
      }
      setPhase('ready');
      scheduleHandsFreeListen();
    } catch (err) {
      setBridgeHealthState('degraded', 'agent: error');
      showError(String(err && err.message || err));
      setPhase('ready');
      // Wait longer after failures so the mic does not re-hear hold music.
      scheduleHandsFreeListen(HANDS_FREE_AFTER_ERROR_MS);
    }
  }

  function startRecording(autoStarted) {
    if (pausedAll) {
      return;
    }
    if (phase !== 'ready' && phase !== 'error') {
      return;
    }
    if (recording) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('Microphone is not available in this browser.');
      return;
    }
    clearAutoListenTimer();
    showError('');
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    }).then(function (stream) {
      if (recording) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      chunks = [];
      recordStream = stream;
      recordMimeType = pickRecorderMimeType();
      var options = recordMimeType ? { mimeType: recordMimeType } : undefined;
      mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      if (!recordMimeType && mediaRecorder.mimeType) {
        recordMimeType = mediaRecorder.mimeType;
      }
      mediaRecorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };
      mediaRecorder.onstop = function () {
        stopSilenceMonitor();
        setTimeout(finalizeRecording, 0);
      };
      recordStartedAt = Date.now();
      mediaRecorder.start(250);
      recording = true;
      startSilenceMonitor(stream);
      updateRecordButton();
    }).catch(function (err) {
      showError(String(err && err.message || err));
      if (autoStarted) {
        scheduleHandsFreeListen();
      }
    });
  }

  function stopRecording(manual) {
    if (!recording) {
      return;
    }
    if (manual && Date.now() - recordStartedAt < MIN_RECORD_MS) {
      showError('Keep recording a moment longer, then tap Stop.');
      return;
    }
    recording = false;
    updateRecordButton();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      if (typeof mediaRecorder.requestData === 'function') {
        mediaRecorder.requestData();
      }
      mediaRecorder.stop();
    }
  }

  recordBtn.onclick = function () {
    if (phase !== 'ready' && phase !== 'error') {
      return;
    }
    if (!recording) {
      startRecording(false);
      return;
    }
    stopRecording(true);
  };

  handsFreeEl.checked = handsFreeEnabled;
  muteEl.checked = muted;
  wakeLockToggleEl.checked = wakeLockEnabled;
  handsFreeEl.onchange = function () {
    if (pausedAll) {
      handsFreeEl.checked = false;
      return;
    }
    handsFreeEnabled = handsFreeEl.checked;
    localStorage.setItem(HANDS_FREE_STORAGE_KEY, handsFreeEnabled ? '1' : '0');
    if (!handsFreeEnabled) {
      clearAutoListenTimer();
      if (recording) {
        stopRecording(true);
      }
      updateRecordButton();
      return;
    }
    if (phase === 'ready' && !recording) {
      scheduleHandsFreeListen();
    }
  };
  muteEl.onchange = function () {
    if (pausedAll) {
      muteEl.checked = true;
      return;
    }
    muted = muteEl.checked;
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    if (muted) {
      stopPlaybackNow();
    }
  };
  var holdMusicToggleEl = document.getElementById('hold-music-toggle');
  holdMusicToggleEl.checked = holdMusicEnabled;
  holdMusicToggleEl.onchange = function () {
    holdMusicEnabled = holdMusicToggleEl.checked;
    localStorage.setItem(chiptuneStorageKey, holdMusicEnabled ? '1' : '0');
    if (!holdMusicEnabled) {
      stopChiptune();
      return;
    }
    if (phase === 'thinking' && !pausedAll) {
      startChiptune();
    }
  };
  wakeLockToggleEl.onchange = function () {
    wakeLockEnabled = wakeLockToggleEl.checked;
    localStorage.setItem(WAKE_LOCK_STORAGE_KEY, wakeLockEnabled ? '1' : '0');
    if (wakeLockEnabled && document.visibilityState === 'visible') {
      requestScreenWakeLock();
      return;
    }
    releaseScreenWakeLock();
  };
  pauseAllBtn.onclick = function () {
    setPauseAll(!pausedAll);
  };

  newSessionBtn.onclick = function () {
    if (phase !== 'ready' && phase !== 'error') {
      return;
    }
    showError('');
    transcriptEl.hidden = true;
    transcriptEl.textContent = '';
    setPhase('thinking');
    fetch('/lets-talk/new-session' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
    }).then(function (r) { return r.json(); }).then(function () {
      setBridgeHealthState('healthy', heartbeatTextFor('healthy'));
      setPhase('ready');
    }).catch(function (err) {
      setBridgeHealthState('degraded', 'agent: error');
      showError(String(err && err.message || err));
      setPhase('ready');
    });
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (wakeLockEnabled) {
        requestScreenWakeLock();
      } else {
        setWakeLockState('inactive', 'wake lock: off');
      }
      pollBridgeHealth();
      return;
    }
    releaseScreenWakeLock();
  });
  window.addEventListener('pagehide', function () {
    releaseScreenWakeLock();
    if (bridgeHealthTimer) {
      clearInterval(bridgeHealthTimer);
      bridgeHealthTimer = null;
    }
    if (bridgeHealthAgeTimer) {
      clearInterval(bridgeHealthAgeTimer);
      bridgeHealthAgeTimer = null;
    }
  });
  bridgeHealthTimer = setInterval(pollBridgeHealth, 5000);
  bridgeHealthAgeTimer = setInterval(updateBridgeHealthFromAge, 1000);
  pollBridgeHealth();
  if (!token) {
    var standaloneNow = false;
    try {
      standaloneNow = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    } catch (_) {}
    if (standaloneNow) {
      showError('Not signed in — open Lets Talk from Telegram or console in Chrome (URL must show bearer), then uninstall and reinstall the app from that page.');
    }
  }
  if (wakeLockEnabled) {
    requestScreenWakeLock();
  } else {
    setWakeLockState('inactive', 'wake lock: off');
  }
})();

// PWA: service worker registration + install prompt
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/lets-talk/sw.js', { scope: '/lets-talk' }).catch(function(){});
}
var deferredInstallPrompt = null;
var pwaInstallBtn = document.getElementById('pwa-install');
var pwaInstallIndicatorEl = document.getElementById('pwa-install-indicator');
var pwaInstallTextEl = document.getElementById('pwa-install-text');
function isStandalonePwaMode() {
  var mediaMatch = false;
  try {
    mediaMatch = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch (_) {}
  return mediaMatch || window.navigator.standalone === true;
}
function setPwaInstallState(state, text) {
  if (pwaInstallIndicatorEl) {
    pwaInstallIndicatorEl.setAttribute('data-state', state);
  }
  if (pwaInstallTextEl) {
    pwaInstallTextEl.textContent = text;
  }
}
function updatePwaInstallButton() {
  if (!pwaInstallBtn) {
    return;
  }
  if (isStandalonePwaMode()) {
    pwaInstallBtn.disabled = true;
    pwaInstallBtn.textContent = 'App installed';
    setPwaInstallState('active', 'install: installed');
    return;
  }
  if (deferredInstallPrompt) {
    pwaInstallBtn.disabled = false;
    pwaInstallBtn.textContent = 'Install app';
    setPwaInstallState('healthy', 'install: available');
    return;
  }
  pwaInstallBtn.disabled = false;
  pwaInstallBtn.textContent = 'Use browser menu to install';
  setPwaInstallState('inactive', 'install: not available');
}
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredInstallPrompt = e;
  updatePwaInstallButton();
});
pwaInstallBtn.onclick = function() {
  if (isStandalonePwaMode()) {
    updatePwaInstallButton();
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function() { updatePwaInstallButton(); });
    deferredInstallPrompt = null;
    return;
  }
  updatePwaInstallButton();
};
window.addEventListener('appinstalled', function() {
  deferredInstallPrompt = null;
  updatePwaInstallButton();
});
updatePwaInstallButton();
</script>
</body>
</html>`;
}
