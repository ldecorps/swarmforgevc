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
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    flex: 1;
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
    border: 3px solid var(--tg-theme-button-color, #238636);
    background: color-mix(in srgb, var(--tg-theme-button-color, #238636) 25%, #111);
    color: var(--tg-theme-button-text-color, #fff);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button.record[aria-pressed="true"] {
    background: var(--tg-theme-button-color, #238636);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--tg-theme-button-color, #238636) 35%, transparent);
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
    accent-color: var(--tg-theme-button-color, #238636);
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Let's Talk</h1>
</header>
<main>
  <p class="state" id="state" data-testid="lets-talk-state" data-phase="ready">ready</p>
  <label class="hands-free" id="hands-free-label">
    <input type="checkbox" id="hands-free" data-testid="lets-talk-hands-free" />
    Hands-free
  </label>
  <button type="button" class="record" id="record" data-testid="lets-talk-record" aria-pressed="false">Record</button>
  <button type="button" class="secondary" id="new-session" data-testid="lets-talk-new-session">New session</button>
  <p class="transcript" id="transcript" data-testid="lets-talk-transcript" hidden></p>
  <p class="error" id="error" data-testid="lets-talk-error" hidden></p>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var q = token ? ('?bearer=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;

  var STT_RETRY_BUDGET = 3;
  var DEFAULT_SPEECH_LOCALE = ${JSON.stringify(speechLocale)};
  var HANDS_FREE_STORAGE_KEY = ${JSON.stringify(LETS_TALK_HANDS_FREE_STORAGE_KEY)};
  var HANDS_FREE_SILENCE_MS = ${LETS_TALK_HANDS_FREE_SILENCE_MS};
  var HANDS_FREE_POST_SPEECH_MS = ${LETS_TALK_HANDS_FREE_POST_SPEECH_MS};
  var HANDS_FREE_MAX_LISTEN_MS = ${LETS_TALK_HANDS_FREE_MAX_LISTEN_MS};
  var SPEECH_LEVEL_THRESHOLD = ${LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD};
  var stateEl = document.getElementById('state');
  var recordBtn = document.getElementById('record');
  var handsFreeEl = document.getElementById('hands-free');
  var newSessionBtn = document.getElementById('new-session');
  var transcriptEl = document.getElementById('transcript');
  var errorEl = document.getElementById('error');

  var phase = 'ready';
  var recording = false;
  var handsFreeEnabled = localStorage.getItem(HANDS_FREE_STORAGE_KEY) === '1';
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
    phase = next;
    stateEl.textContent = next;
    stateEl.setAttribute('data-phase', next);
    var busy = next === 'thinking' || next === 'speaking';
    recordBtn.disabled = busy;
    newSessionBtn.disabled = busy;
    handsFreeEl.disabled = busy;
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

  function scheduleHandsFreeListen() {
    clearAutoListenTimer();
    if (!handsFreeEnabled || phase !== 'ready' || recording) {
      return;
    }
    autoListenTimer = setTimeout(function () {
      autoListenTimer = null;
      if (handsFreeEnabled && phase === 'ready' && !recording) {
        startRecording(true);
      }
    }, HANDS_FREE_POST_SPEECH_MS);
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
      if (playbackAudio) {
        playbackAudio.pause();
        playbackAudio = null;
      }
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
      throw new Error(payload && payload.reason ? String(payload.reason) : ('HTTP ' + res.status));
    }
    if (payload && payload.success) {
      return payload;
    }
    if (payload && payload.recoverable && payload.state === 'error' && sttAttempt + 1 < STT_RETRY_BUDGET) {
      setPhase('error');
      await new Promise(function (r) { setTimeout(r, 50); });
      setPhase('thinking');
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
      var audioBase64 = await blobToBase64(blob);
      var result = await submitTurn({ audioBase64: audioBase64, mimeType: mimeType }, 0);
      transcriptEl.hidden = false;
      transcriptEl.textContent = result.replyText || result.transcript || '';
      setPhase('speaking');
      if (result.replyAudioBase64) {
        await playReplyAudio(result.replyAudioBase64, 'audio/ogg');
      } else if (result.replySpeechText || result.replyText) {
        await speakReplyText(result.replySpeechText || result.replyText, result.speechLocale || DEFAULT_SPEECH_LOCALE);
      }
      setPhase('ready');
      scheduleHandsFreeListen();
    } catch (err) {
      showError(String(err && err.message || err));
      setPhase('ready');
      scheduleHandsFreeListen();
    }
  }

  function startRecording(autoStarted) {
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
  handsFreeEl.onchange = function () {
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
      setPhase('ready');
    }).catch(function (err) {
      showError(String(err && err.message || err));
      setPhase('ready');
    });
  };
})();
</script>
</body>
</html>`;
}
