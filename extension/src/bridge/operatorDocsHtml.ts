// BL-1166: Operator docs remote HTML page — browse docs/ via docs/index.md.
import * as fs from 'fs';
import * as path from 'path';
import {
  buildOperatorDocsPagePayload,
  computeOperatorDocsIndex,
  isSafeDocsRelativePath,
  type OperatorDocsIndexPayload,
  type OperatorDocsPagePayload,
} from './operatorDocsCore';

export function getOperatorDocsUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Operator docs</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    color-scheme: dark;
    --od-font-px: 16px;
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
    font-size: var(--od-font-px);
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
    font-size: calc(var(--od-font-px) + 1px);
    margin: 0;
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 0;
  }
  a.back, a.nav {
    font-size: calc(var(--od-font-px) - 2px);
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
    font-size: calc(var(--od-font-px) + 2px);
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
  .doc-body pre {
    overflow-x: auto;
    max-width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 80%, #fff 6%);
    font-size: calc(var(--od-font-px) - 2px);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .doc-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: calc(var(--od-font-px) - 1px);
  }
  .unavailable, .loading {
    color: var(--tg-theme-hint-color, #8b949e);
    padding: 16px 4px;
    line-height: 1.45;
  }
  .unavailable strong { color: var(--tg-theme-text-color, #e6edf3); }
</style>
</head>
<body>
<header>
  <a class="back" id="back" href="#">Back</a>
  <h1 id="title">Operator authored documentation</h1>
  <div class="font-controls">
    <button type="button" class="font-btn" id="font-dec" aria-label="Smaller text">A-</button>
    <button type="button" class="font-btn" id="font-inc" aria-label="Larger text">A+</button>
  </div>
</header>
<main id="content"><p class="loading">Loading Operator docs…</p></main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var q = token ? ('?bearer=' + encodeURIComponent(token)) : '';
  var pagePath = params.get('path') || '';
  var contentEl = document.getElementById('content');
  var titleEl = document.getElementById('title');
  var backEl = document.getElementById('back');

  var FONT_MIN = 14;
  var FONT_MAX = 28;
  var FONT_DEFAULT = 16;
  var FONT_STEP = 2;

  function currentFontPx() {
    var raw = document.documentElement.style.getPropertyValue('--od-font-px');
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : FONT_DEFAULT;
  }

  function applyFont(px) {
    var clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    document.documentElement.style.setProperty('--od-font-px', clamped + 'px');
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
    contentEl.innerHTML = '<div class="unavailable"><strong>Operator docs unavailable</strong><br/>'
      + 'Bridge reachability is required to browse the authored docs corpus. '
      + escapeHtml(String(reason || 'could not reach the bridge feed')) + '</div>';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderIndex(data) {
    titleEl.textContent = 'Operator authored documentation';
    backEl.style.display = 'none';
    var html = '';
    (data.sections || []).forEach(function (section) {
      html += '<section class="section">';
      html += '<h2>' + escapeHtml(section.heading || section.mode) + '</h2><ul>';
      (section.links || []).forEach(function (link) {
        var href = '/operator-docs' + authQuery()
          + (authQuery() ? '&' : '?') + 'path=' + encodeURIComponent(link.path);
        html += '<li><a href="' + href + '">' + escapeHtml(link.title) + '</a></li>';
      });
      html += '</ul></section>';
    });
    contentEl.innerHTML = html || '<p class="unavailable">No sections found in docs/index.md.</p>';
  }

  function renderPage(data) {
    titleEl.textContent = data.title || 'Operator doc';
    backEl.style.display = '';
    backEl.href = '/operator-docs' + authQuery();
    contentEl.innerHTML = '<article class="doc-body">' + (data.html || '') + '</article>';
  }

  function loadIndex() {
    fetch('/operator-docs-index' + authQuery(), { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(renderIndex)
      .catch(function (err) { showUnavailable(err && err.message); });
  }

  function loadPage(pathValue) {
    var pageQuery = authQuery();
    pageQuery += (pageQuery ? '&' : '?') + 'path=' + encodeURIComponent(pathValue);
    fetch('/operator-docs-page' + pageQuery, { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(renderPage)
      .catch(function (err) { showUnavailable(err && err.message); });
  }

  if (pagePath) {
    loadPage(pagePath);
  } else {
    loadIndex();
  }
})();
</script>
</body>
</html>`;
}

export function isOperatorDocsPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/operator-docs';
}

export function isOperatorDocsIndexPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/operator-docs-index';
}

export function isOperatorDocsPagePath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/operator-docs-page';
}

function readDocsIndexMd(targetPath: string): string | null {
  const indexPath = path.join(targetPath, 'docs', 'index.md');
  try {
    return fs.readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
}

export function buildOperatorDocsIndexState(targetPath: string): OperatorDocsIndexPayload | { error: string } {
  const indexContent = readDocsIndexMd(targetPath);
  if (indexContent === null) {
    return { error: 'docs/index.md is missing' };
  }
  return computeOperatorDocsIndex(indexContent);
}

function docsRelativePathFromUrl(url: string): string | null {
  const params = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
  const raw = params.get('path');
  if (!raw) {
    return null;
  }
  const decoded = decodeURIComponent(raw);
  return isSafeDocsRelativePath(decoded) ? decoded.replace(/\\/g, '/') : null;
}

export function buildOperatorDocsPageState(targetPath: string, url: string): OperatorDocsPagePayload | { error: string } {
  const relativePath = docsRelativePathFromUrl(url);
  if (!relativePath) {
    return { error: 'invalid docs path' };
  }
  const absolutePath = path.join(targetPath, 'docs', relativePath);
  let markdown: string;
  try {
    markdown = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return { error: 'document not found' };
  }
  return buildOperatorDocsPagePayload(markdown, relativePath);
}
