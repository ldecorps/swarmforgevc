// Article drafts remote HTML — browse .swarmforge/operator/DRAFT-linkedin-*.md
import * as fs from 'fs';
import * as path from 'path';
import {
  ARTICLE_DRAFT_FILENAME_RE,
  buildArticleDraftPagePayload,
  computeArticleDraftsIndex,
  isSafeArticleDraftFilename,
  type ArticleDraftPagePayload,
  type ArticleDraftsIndexPayload,
} from './articleDraftsCore';

function operatorDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator');
}

export function getArticleDraftsUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Article drafts</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    color-scheme: dark;
    --ad-font-px: 16px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
    font-size: var(--ad-font-px);
    line-height: 1.5;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    font-size: calc(var(--ad-font-px) + 1px);
    margin: 0;
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 0;
  }
  a.back {
    font-size: calc(var(--ad-font-px) - 2px);
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    flex: 0 0 auto;
  }
  .font-controls { display: flex; gap: 4px; margin-left: auto; }
  button.font-btn {
    padding: 2px 7px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 45%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 70%, #fff 8%);
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
  }
  button.font-btn[disabled] { opacity: 0.4; cursor: default; }
  main { padding: 12px 14px 24px; max-width: 100%; overflow-x: hidden; }
  .section { margin-bottom: 18px; }
  .section h2 {
    font-size: calc(var(--ad-font-px) + 2px);
    margin: 0 0 8px;
  }
  .section ul { margin: 0; padding-left: 1.1rem; }
  .section li { margin: 6px 0; }
  .section a {
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .doc-body h1, .doc-body h2, .doc-body h3 {
    line-height: 1.25;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .doc-body p, .doc-body li {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .doc-body a { color: var(--tg-theme-link-color, #58a6ff); }
  .doc-body pre {
    overflow-x: auto;
    max-width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 80%, #fff 6%);
    font-size: calc(var(--ad-font-px) - 2px);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .doc-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: calc(var(--ad-font-px) - 1px);
  }
  .unavailable, .loading {
    color: var(--tg-theme-hint-color, #8b949e);
    padding: 16px 4px;
    line-height: 1.45;
  }
  .unavailable strong { color: var(--tg-theme-text-color, #e6edf3); }
  button.listen-btn {
    flex: 0 0 auto;
    padding: 6px 12px;
    font-size: calc(var(--ad-font-px) - 2px);
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-button-color, #238636) 55%, transparent);
    background: var(--tg-theme-button-color, #238636);
    color: var(--tg-theme-button-text-color, #fff);
    cursor: pointer;
  }
  button.listen-btn.listening {
    background: color-mix(in srgb, #da3633 85%, #111);
    border-color: color-mix(in srgb, #da3633 55%, #000);
  }
  button.listen-btn[disabled] { opacity: 0.45; cursor: default; }
  .draft-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 10px 0;
  }
  .draft-row a {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .draft-row .listen-btn { flex: 0 0 auto; margin-top: 2px; }
  .page-listen-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0 0 14px;
  }
  .listen-hint {
    font-size: calc(var(--ad-font-px) - 3px);
    color: var(--tg-theme-hint-color, #8b949e);
  }
</style>
</head>
<body>
<header>
  <a class="back" id="back" href="#">Back</a>
  <h1 id="title">Article drafts</h1>
  <button type="button" class="listen-btn" id="header-listen" style="display:none" data-testid="article-drafts-listen">Listen</button>
  <div class="font-controls">
    <button type="button" class="font-btn" id="font-dec" aria-label="Smaller text">A-</button>
    <button type="button" class="font-btn" id="font-inc" aria-label="Larger text">A+</button>
  </div>
</header>
<main id="content"><p class="loading">Loading article drafts…</p></main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var fileParam = params.get('file') || '';
  var contentEl = document.getElementById('content');
  var titleEl = document.getElementById('title');
  var backEl = document.getElementById('back');
  var headerListenEl = document.getElementById('header-listen');
  var currentSpeechText = '';
  var speechByFile = {};
  var speaking = false;

  var FONT_MIN = 14;
  var FONT_MAX = 28;
  var FONT_DEFAULT = 16;
  var FONT_STEP = 2;

  function currentFontPx() {
    var raw = document.documentElement.style.getPropertyValue('--ad-font-px');
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : FONT_DEFAULT;
  }

  function applyFont(px) {
    var clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    document.documentElement.style.setProperty('--ad-font-px', clamped + 'px');
    document.getElementById('font-dec').disabled = clamped <= FONT_MIN;
    document.getElementById('font-inc').disabled = clamped >= FONT_MAX;
  }

  document.getElementById('font-dec').onclick = function () { applyFont(currentFontPx() - FONT_STEP); };
  document.getElementById('font-inc').onclick = function () { applyFont(currentFontPx() + FONT_STEP); };
  applyFont(FONT_DEFAULT);

  function authQuery() {
    return token ? ('?bearer=' + encodeURIComponent(token)) : '';
  }

  function showUnavailable(reason) {
    stopSpeaking();
    headerListenEl.style.display = 'none';
    contentEl.innerHTML = '<div class="unavailable"><strong>Article drafts unavailable</strong><br/>'
      + escapeHtml(String(reason || 'could not reach the bridge feed')) + '</div>';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function speechAvailable() {
    return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  function chunkSpeechText(text) {
    var parts = String(text || '').split(/\\n\\n+/);
    var chunks = [];
    var buf = '';
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      if (buf && (buf.length + part.length) > 1600) {
        chunks.push(buf);
        buf = part;
      } else {
        buf = buf ? (buf + '\\n\\n' + part) : part;
      }
    }
    if (buf) chunks.push(buf);
    return chunks.length ? chunks : [String(text || '')];
  }

  function setListenButtonsLabel(label, isListening) {
    var buttons = document.querySelectorAll('button.listen-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.getAttribute('data-role') === 'row-listen' && !isListening) {
        btn.textContent = 'Listen';
        btn.classList.remove('listening');
        continue;
      }
      if (isListening) {
        btn.textContent = 'Stop';
        btn.classList.add('listening');
      } else if (btn === headerListenEl || btn.getAttribute('data-role') === 'page-listen') {
        btn.textContent = label || 'Listen';
        btn.classList.remove('listening');
      } else if (btn.getAttribute('data-role') === 'row-listen') {
        btn.textContent = 'Listen';
        btn.classList.remove('listening');
      }
    }
  }

  function stopSpeaking() {
    speaking = false;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setListenButtonsLabel('Listen', false);
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
        if (done) return;
        done = true;
        resolve();
      }
      window.speechSynthesis.onvoiceschanged = finish;
      setTimeout(finish, 250);
    });
  }

  function speakText(text) {
    if (!speechAvailable()) {
      alert('Read-aloud is not available in this browser.');
      return Promise.resolve();
    }
    if (!text || !String(text).trim()) {
      alert('Nothing to read for this draft.');
      return Promise.resolve();
    }
    stopSpeaking();
    speaking = true;
    setListenButtonsLabel('Stop', true);
    var chunks = chunkSpeechText(text);
    var locale = (navigator.language || 'en-GB');
    return ensureSpeechVoices().then(function () {
      return new Promise(function (resolve) {
        var i = 0;
        function next() {
          if (!speaking || i >= chunks.length) {
            speaking = false;
            setListenButtonsLabel('Listen', false);
            resolve();
            return;
          }
          var utter = new SpeechSynthesisUtterance(chunks[i++]);
          utter.lang = locale;
          var voices = window.speechSynthesis.getVoices() || [];
          var prefix = String(locale).split('-')[0].toLowerCase();
          for (var v = 0; v < voices.length; v++) {
            var lang = (voices[v].lang || '').toLowerCase();
            if (lang === String(locale).toLowerCase() || lang.startsWith(prefix)) {
              utter.voice = voices[v];
              break;
            }
          }
          utter.onend = next;
          utter.onerror = function () {
            speaking = false;
            setListenButtonsLabel('Listen', false);
            resolve();
          };
          window.speechSynthesis.speak(utter);
        }
        next();
      });
    });
  }

  function toggleSpeak(text) {
    if (speaking) {
      stopSpeaking();
      return;
    }
    speakText(text);
  }

  headerListenEl.onclick = function () {
    toggleSpeak(currentSpeechText);
  };

  function wireRowListenButtons() {
    var buttons = contentEl.querySelectorAll('button.listen-btn[data-role="row-listen"]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var file = this.getAttribute('data-file') || '';
        toggleSpeak(speechByFile[file] || '');
      };
    }
  }

  function renderIndex(data) {
    stopSpeaking();
    currentSpeechText = '';
    speechByFile = {};
    titleEl.textContent = 'Article drafts';
    backEl.style.display = 'none';
    headerListenEl.style.display = 'none';
    var drafts = data.drafts || [];
    if (drafts.length === 0) {
      contentEl.innerHTML = '<p class="unavailable">No DRAFT-linkedin-*.md files under .swarmforge/operator/.</p>';
      return;
    }
    var canSpeak = speechAvailable();
    var html = '<section class="section"><h2>LinkedIn drafts</h2>';
    if (!canSpeak) {
      html += '<p class="listen-hint">Read-aloud needs a browser with speech synthesis.</p>';
    }
    drafts.forEach(function (draft) {
      speechByFile[draft.file] = draft.speechText || '';
      var href = '/article-drafts' + authQuery()
        + (authQuery() ? '&' : '?') + 'file=' + encodeURIComponent(draft.file);
      html += '<div class="draft-row">';
      html += '<a href="' + href + '">' + escapeHtml(draft.title) + '</a>';
      if (canSpeak && draft.speechText) {
        html += '<button type="button" class="listen-btn" data-role="row-listen" data-testid="article-drafts-row-listen" data-file="'
          + escapeHtml(draft.file) + '">Listen</button>';
      }
      html += '</div>';
    });
    html += '</section>';
    contentEl.innerHTML = html;
    wireRowListenButtons();
  }

  function renderPage(data) {
    stopSpeaking();
    currentSpeechText = data.speechText || '';
    titleEl.textContent = data.title || 'Draft';
    backEl.style.display = '';
    backEl.href = '/article-drafts' + authQuery();
    var canSpeak = speechAvailable() && !!currentSpeechText;
    headerListenEl.style.display = canSpeak ? '' : 'none';
    headerListenEl.textContent = 'Listen';
    var bar = canSpeak
      ? '<div class="page-listen-bar"><button type="button" class="listen-btn" data-role="page-listen" data-testid="article-drafts-page-listen">Listen</button><span class="listen-hint">Reads this draft aloud on your phone</span></div>'
      : '';
    contentEl.innerHTML = bar + '<article class="doc-body">' + (data.html || '') + '</article>';
    var pageBtn = contentEl.querySelector('button.listen-btn[data-role="page-listen"]');
    if (pageBtn) {
      pageBtn.onclick = function () { toggleSpeak(currentSpeechText); };
    }
  }

  function loadIndex() {
    fetch('/article-drafts-index' + authQuery(), { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(renderIndex)
      .catch(function (err) { showUnavailable(err && err.message); });
  }

  function loadPage(fileValue) {
    var pageQuery = authQuery();
    pageQuery += (pageQuery ? '&' : '?') + 'file=' + encodeURIComponent(fileValue);
    fetch('/article-drafts-page' + pageQuery, { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(renderPage)
      .catch(function (err) { showUnavailable(err && err.message); });
  }

  if (fileParam) {
    loadPage(fileParam);
  } else {
    loadIndex();
  }
})();
</script>
</body>
</html>`;
}

export function isArticleDraftsPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/article-drafts';
}

export function isArticleDraftsIndexPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/article-drafts-index';
}

export function isArticleDraftsPagePath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/article-drafts-page';
}

export function buildArticleDraftsIndexState(targetPath: string): ArticleDraftsIndexPayload {
  const dir = operatorDir(targetPath);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((name) => ARTICLE_DRAFT_FILENAME_RE.test(name));
  } catch {
    return { drafts: [] };
  }
  const entries = [];
  for (const file of names) {
    const absolute = path.join(dir, file);
    try {
      const st = fs.statSync(absolute);
      if (!st.isFile()) {
        continue;
      }
      entries.push({
        file,
        mtimeMs: st.mtimeMs,
        markdown: fs.readFileSync(absolute, 'utf8'),
      });
    } catch {
      // skip unreadable
    }
  }
  return computeArticleDraftsIndex(entries);
}

function draftFilenameFromUrl(url: string): string | null {
  const params = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
  const raw = params.get('file');
  if (!raw) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isSafeArticleDraftFilename(decoded) ? decoded : null;
}

export function buildArticleDraftPageState(
  targetPath: string,
  url: string
): ArticleDraftPagePayload | { error: string } {
  const file = draftFilenameFromUrl(url);
  if (!file) {
    return { error: 'invalid draft file' };
  }
  const absolutePath = path.join(operatorDir(targetPath), file);
  let markdown: string;
  try {
    markdown = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return { error: 'draft not found' };
  }
  return buildArticleDraftPagePayload(markdown, file);
}
