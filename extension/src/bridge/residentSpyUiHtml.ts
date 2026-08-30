// BL-522: Telegram Mini App shell for the swarm live screen (mono-router or
// full stack). Self-contained except telegram-web-app.js. Polls GET
// /resident-pane?token=... on the same origin.

import { SWARM_LIVE_SCREEN_NAME } from '../concierge/residentPaneSpy';
import {
  PANE_FONT_CROWDED_DELTA_PX,
  PANE_FONT_DEFAULT_PX,
  PANE_FONT_MAX_PX,
  PANE_FONT_MIN_PX,
  PANE_FONT_STEP_PX,
} from './residentSpyPaneFontSize';

export function getResidentSpyUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="theme-color" content="#0d1117"/>
<title>${SWARM_LIVE_SCREEN_NAME}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    color-scheme: dark;
    --app-height: 100dvh;
    --app-width: 100vw;
    --vv-offset-top: 0px;
    --vv-offset-left: 0px;
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --pane-font-size: ${PANE_FONT_DEFAULT_PX}px;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 100%;
    height: var(--app-height);
    max-height: var(--app-height);
    overflow: hidden;
  }
  body.pane-fullscreen-active {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3fb950;
    pointer-events: none;
    flex: 0 0 auto;
  }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  .pane-status-dot {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 2;
  }
  #fs-dot {
    position: fixed;
    bottom: max(6px, env(safe-area-inset-bottom));
    left: max(6px, env(safe-area-inset-left));
    z-index: 40;
  }
  .split-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  body.pane-fullscreen-active .split-view {
    display: none;
  }
  .ticket-strip {
    flex: 0 0 auto;
    padding: 8px 10px;
    padding-top: max(8px, env(safe-area-inset-top));
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #000);
  }
  .ticket-strip-line {
    font-size: 12px;
    line-height: 1.35;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .ticket-strip-id {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .ticket-strip-title {
    font-weight: 600;
  }
  .ticket-strip-meta {
    margin-top: 3px;
    font-size: 10px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .pane-offline {
    flex: 0 0 auto;
    margin: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: #f85149;
    background: color-mix(in srgb, #f85149 12%, var(--tg-theme-bg-color, #0d1117));
    border: 1px solid color-mix(in srgb, #f85149 35%, transparent);
  }
  /* Square-ish role tiles: CSS grid so panes cannot shrink into thin strips.
     Phone default is 2 columns (2×2 for 4 workers). Transcript is fullscreen-only. */
  .split {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 1fr;
    min-height: 0;
    overflow: hidden;
  }
  .split.pane-count-1 {
    grid-template-columns: minmax(0, 1fr);
  }
  .split.pane-count-5,
  .split.pane-count-6,
  .split.pane-count-7,
  .split.pane-count-8 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media (min-width: 700px) {
    .split.pane-count-5,
    .split.pane-count-6 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .split.pane-count-7,
    .split.pane-count-8 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .pane-col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .pane-head {
    flex: 1 1 auto;
    min-height: 0;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    position: relative;
    user-select: none;
  }
  .pane-head-main {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    text-align: center;
  }
  .pane-expand-hint {
    position: absolute;
    top: 8px;
    right: 8px;
    font-size: 10px;
    line-height: 1.2;
    padding: 3px 6px;
    border-radius: 4px;
    color: var(--tg-theme-hint-color, #8b949e);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
    white-space: nowrap;
  }
  .pane-kind {
    font-size: clamp(13px, 4.5vw, 20px);
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.2;
    text-transform: uppercase;
    color: var(--tg-theme-text-color, #e6edf3);
    margin: 0;
    word-break: normal;
    overflow-wrap: normal;
  }
  /* Grid tiles: role name + held ticket strip + Expand; transcript in fullscreen. */
  .split .pane-col > pre {
    display: none;
  }
  .pane-grid-ticket {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.25;
  }
  .pane-grid-ticket-id {
    font-size: clamp(9px, 3.2vw, 11px);
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .pane-grid-slug {
    font-size: clamp(8px, 2.8vw, 10px);
    font-weight: 500;
    color: color-mix(in srgb, var(--tg-theme-text-color, #e6edf3) 82%, var(--tg-theme-hint-color, #8b949e));
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .pane-grid-age,
  .pane-grid-more {
    font-size: clamp(8px, 2.8vw, 10px);
    font-weight: 600;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .pane-grid-more {
    color: color-mix(in srgb, var(--tg-theme-link-color, #58a6ff) 88%, #fff);
  }
  .pane-title {
    font-size: 12px;
    line-height: 1.35;
    font-weight: 700;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  .split.pane-count-7 .pane-title,
  .split.pane-count-8 .pane-title { font-size: 11px; }
  .pane-ticket {
    margin-top: 4px;
    font-size: 10px;
    line-height: 1.35;
    font-weight: 500;
    color: color-mix(in srgb, var(--tg-theme-text-color, #e6edf3) 88%, var(--tg-theme-hint-color, #8b949e));
  }
  .pane-ticket-id {
    font-weight: 700;
    color: var(--tg-theme-text-color, #e6edf3);
  }
  pre {
    flex: 1 1 0;
    margin: 0;
    padding: 8px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--pane-font-size);
    line-height: 1.35;
    min-height: 0;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
  }
  /* BL-609: crowded grids pack a fixed step tighter than the chosen size. */
  .split.pane-count-7 pre,
  .split.pane-count-8 pre {
    font-size: calc(var(--pane-font-size) - ${PANE_FONT_CROWDED_DELTA_PX}px);
  }
  .pane-fullscreen {
    display: none;
    position: fixed;
    top: var(--vv-offset-top);
    left: var(--vv-offset-left);
    width: var(--app-width);
    height: var(--app-height);
    z-index: 30;
    flex-direction: column;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  }
  body.pane-fullscreen-active .pane-fullscreen {
    display: flex;
  }
  .pane-fullscreen:fullscreen,
  .pane-fullscreen:-webkit-full-screen {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
  }
  .fs-top {
    flex: 0 0 auto;
    padding: 8px 10px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #000);
  }
  .fs-top-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  #fs-head {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* BL-609: compact +/- sits beside the protected header content, not inside
     #fs-head, so syncFullscreenContent repaints never wipe the control. */
  .fs-font-ctrl {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .fs-font-ctrl button {
    margin: 0;
    padding: 1px 5px;
    min-width: 18px;
    line-height: 1.2;
    font-size: 9px;
    font-family: inherit;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 40%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 80%, #000);
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .fs-font-ctrl button.is-unavailable,
  .fs-font-ctrl button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  #fs-pre {
    flex: 1 1 auto;
    min-height: 0;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
</style>
</head>
<body>
<div class="split-view" id="split-view">
  <div id="ticket-strip" class="ticket-strip" hidden>
    <div class="ticket-strip-line"><span class="ticket-strip-id" id="ticket-strip-id"></span> - <span class="ticket-strip-title" id="ticket-strip-title"></span></div>
    <div class="ticket-strip-meta" id="ticket-strip-meta"></div>
  </div>
  <div id="pane-offline" class="pane-offline" hidden>Live panes unavailable — swarm agents may be down.</div>
  <div class="split" id="pane-split"></div>
</div>
<div id="pane-fullscreen" class="pane-fullscreen" hidden>
  <span id="fs-dot" class="dot" hidden></span>
  <div class="fs-top" id="fs-top">
    <div class="fs-top-row">
      <div id="fs-head"></div>
      <div id="fs-font-ctrl" class="fs-font-ctrl" aria-label="Pane text size">
        <button type="button" id="fs-font-dec" aria-label="Decrease pane text size">−</button>
        <button type="button" id="fs-font-inc" aria-label="Increase pane text size">+</button>
      </div>
    </div>
  </div>
  <pre id="fs-pre"></pre>
</div>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var splitEl = document.getElementById('pane-split');
  var fsDotEl = document.getElementById('fs-dot');
  var ticketStripEl = document.getElementById('ticket-strip');
  var ticketStripIdEl = document.getElementById('ticket-strip-id');
  var ticketStripTitleEl = document.getElementById('ticket-strip-title');
  var ticketStripMetaEl = document.getElementById('ticket-strip-meta');
  var paneOfflineEl = document.getElementById('pane-offline');
  var paneFullscreenEl = document.getElementById('pane-fullscreen');
  var fsTopEl = document.getElementById('fs-top');
  var fsHeadEl = document.getElementById('fs-head');
  var fsPreEl = document.getElementById('fs-pre');
  var fsFontDecEl = document.getElementById('fs-font-dec');
  var fsFontIncEl = document.getElementById('fs-font-inc');
  var fsFontCtrlEl = document.getElementById('fs-font-ctrl');
  // BL-1153: host-persisted via GET/PUT /web-ui-font-size (Rule 3 — no browser storage).
  var paneFontSizePx = ${PANE_FONT_DEFAULT_PX};
  var PANE_FONT_MIN = ${PANE_FONT_MIN_PX};
  var PANE_FONT_MAX = ${PANE_FONT_MAX_PX};
  var PANE_FONT_STEP = ${PANE_FONT_STEP_PX};
  var focusPane = null;
  var lastOk = 0;
  var claimEnteredByPaneId = {};
  var ticketStripClaimEnteredAtMs = null;
  var ticketStripMetaBase = '';
  var fsClaimEnteredAtMs = null;
  var fsTitleBase = '';
  var lastPanes = [];
  var lastFetchAvailable = false;
  var lastAggregateStatus = null;
  // BL-929: false until a snapshot says otherwise, so a standing full pack
  // never shows the top ticket strip even on the very first paint (fails
  // closed toward the layout that has no strip, not toward the one that
  // does).
  var lastMonoRouterLayout = false;

  function clampPaneFontSizePx(px) {
    if (!isFinite(px)) return ${PANE_FONT_DEFAULT_PX};
    if (px < PANE_FONT_MIN) return PANE_FONT_MIN;
    if (px > PANE_FONT_MAX) return PANE_FONT_MAX;
    return Math.round(px);
  }

  function stepPaneFontSizePx(current, direction) {
    return clampPaneFontSizePx(clampPaneFontSizePx(current) + direction * PANE_FONT_STEP);
  }

  function fontControlAuthHeaders() {
    if (!token) {
      return { 'content-type': 'application/json' };
    }
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      'x-control-token': token,
    };
  }

  function persistPaneFontSize() {
    if (!token) return;
    fetch('/web-ui-font-size?bearer=' + encodeURIComponent(token), {
      method: 'PUT',
      headers: fontControlAuthHeaders(),
      body: JSON.stringify({ surface: 'live-screen', fontSizePx: paneFontSizePx }),
    }).catch(function () {});
  }

  function applyPaneFontSize(persist) {
    paneFontSizePx = clampPaneFontSizePx(paneFontSizePx);
    document.documentElement.style.setProperty('--pane-font-size', paneFontSizePx + 'px');
    var atMin = paneFontSizePx <= PANE_FONT_MIN;
    var atMax = paneFontSizePx >= PANE_FONT_MAX;
    fsFontDecEl.disabled = atMin;
    fsFontIncEl.disabled = atMax;
    fsFontDecEl.classList.toggle('is-unavailable', atMin);
    fsFontIncEl.classList.toggle('is-unavailable', atMax);
    if (persist) {
      persistPaneFontSize();
    }
  }

  function loadPaneFontSize() {
    if (!token) {
      applyPaneFontSize(false);
      return;
    }
    fetch('/web-ui-font-size?surface=live-screen&bearer=' + encodeURIComponent(token), {
      cache: 'no-store',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.success && typeof data.fontSizePx === 'number') {
          paneFontSizePx = data.fontSizePx;
        }
        applyPaneFontSize(false);
      })
      .catch(function () { applyPaneFontSize(false); });
  }

  function inTelegram() {
    return !!(tg && tg.initData);
  }

  function isBrowserFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function applySafeAreas() {
    if (!tg || !tg.safeAreaInset) return;
    var inset = tg.safeAreaInset;
    if (inset.top) document.documentElement.style.setProperty('--safe-top', inset.top + 'px');
    if (inset.right) document.documentElement.style.setProperty('--safe-right', inset.right + 'px');
    if (inset.bottom) document.documentElement.style.setProperty('--safe-bottom', inset.bottom + 'px');
    if (inset.left) document.documentElement.style.setProperty('--safe-left', inset.left + 'px');
  }

  function shouldPinViewportHeight() {
    return inTelegram() || !!focusPane;
  }

  function applyViewportHeight() {
    if (!shouldPinViewportHeight()) {
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--app-width');
      document.documentElement.style.removeProperty('--vv-offset-top');
      document.documentElement.style.removeProperty('--vv-offset-left');
      return;
    }
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (window.visualViewport) {
      if (window.visualViewport.width > 0) {
        w = Math.round(window.visualViewport.width);
      }
      if (window.visualViewport.height > 0) {
        h = Math.round(window.visualViewport.height);
      }
      document.documentElement.style.setProperty('--vv-offset-top', Math.round(window.visualViewport.offsetTop) + 'px');
      document.documentElement.style.setProperty('--vv-offset-left', Math.round(window.visualViewport.offsetLeft) + 'px');
    } else {
      document.documentElement.style.setProperty('--vv-offset-top', '0px');
      document.documentElement.style.setProperty('--vv-offset-left', '0px');
    }
    if (tg && !focusPane) {
      h = tg.viewportStableHeight || tg.viewportHeight || h;
    }
    if (w > 0) {
      document.documentElement.style.setProperty('--app-width', w + 'px');
    }
    if (h > 0) {
      document.documentElement.style.setProperty('--app-height', h + 'px');
    }
    applySafeAreas();
  }

  if (inTelegram()) {
    tg.ready();
    tg.expand();
    applySafeAreas();
  }

  if (inTelegram() && tg && typeof tg.onEvent === 'function') {
    tg.onEvent('viewportChanged', applyViewportHeight);
    tg.onEvent('safeAreaChanged', applySafeAreas);
    tg.onEvent('fullscreenChanged', applyViewportHeight);
    if (typeof tg.on === 'function') {
      tg.on('viewportChanged', applyViewportHeight);
      tg.on('safeAreaChanged', applySafeAreas);
      tg.on('fullscreenChanged', applyViewportHeight);
    }
  }
  window.addEventListener('resize', applyViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyViewportHeight);
    window.visualViewport.addEventListener('scroll', applyViewportHeight);
  }
  function onFullscreenChange() {
    applyViewportHeight();
    if (focusPane && !inTelegram() && !isBrowserFullscreen()) {
      exitFullscreen();
    }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  applyViewportHeight();

  function requestBrowserFullscreen() {
    if (isBrowserFullscreen()) return;
    var target = paneFullscreenEl;
    var req =
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(target);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function exitBrowserFullscreen() {
    if (!isBrowserFullscreen()) return;
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return;
    try {
      var p = exit.call(document);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  // Telegram: tg.requestFullscreen(). Browser (Cloudflare tunnel): native
  // requestFullscreen on the pane overlay — shows the system exit banner but
  // fills the real display. CSS overlay + visualViewport sizing is fallback
  // when the API is unavailable.
  function enterImmersiveFullscreen() {
    applyViewportHeight();
    if (inTelegram()) {
      tg.expand();
      if (typeof tg.setHeaderColor === 'function') {
        tg.setHeaderColor('bg_color');
      }
      if (typeof tg.requestFullscreen === 'function') {
        try {
          tg.requestFullscreen();
        } catch (e) {}
      }
    } else {
      requestBrowserFullscreen();
    }
  }

  function exitImmersiveFullscreen() {
    if (inTelegram()) {
      if (typeof tg.exitFullscreen === 'function' && tg.isFullscreen) {
        try {
          tg.exitFullscreen();
        } catch (e) {}
      }
      tg.expand();
    } else {
      exitBrowserFullscreen();
    }
    applyViewportHeight();
  }

  function paneEntryById(paneId) {
    for (var i = 0; i < lastPanes.length; i++) {
      if (lastPanes[i].id === paneId) return lastPanes[i];
    }
    return null;
  }

  function buildPaneHeadHtml(pane, label, paneId, showClaimEntered) {
    if (!pane || pane.available === false) {
      return '<div class="pane-kind">' + escapeHtml(label) + '</div><div class="pane-title">' + escapeHtml(label) + ' (unavailable)</div>';
    }
    var title = pane.roleLabel || 'unknown';
    if (pane.modelLabel) {
      title += ' on ' + pane.modelLabel;
    }
    if (showClaimEntered && pane.claimEnteredAtMs) {
      title += ' · ' + formatClaimEnteredAgo(pane.claimEnteredAtMs);
      claimEnteredByPaneId[paneId] = pane.claimEnteredAtMs;
    } else {
      delete claimEnteredByPaneId[paneId];
    }
    var html = '<div class="pane-kind">' + escapeHtml(label) + '</div>';
    html += '<div class="pane-title" data-pane-title="' + escapeHtml(paneId) + '">' + escapeHtml(title) + '</div>';
    if (pane.ticketId) {
      html += '<div class="pane-ticket"><span class="pane-ticket-id">' + escapeHtml(pane.ticketId) + '</span>';
      if (pane.ticketTitle) {
        html += ' — ' + escapeHtml(pane.ticketTitle);
      }
      html += '</div>';
    }
    return html;
  }

  function buildTicketBlockHtml(pane) {
    if (!pane || !pane.ticketId) return '';
    var html = '<div class="ticket-strip-line"><span class="ticket-strip-id">' + escapeHtml(pane.ticketId) + '</span> - ';
    html += '<span class="ticket-strip-title">' + escapeHtml(pane.ticketTitle || '(untitled)') + '</span></div>';
    var meta = pane.roleLabel || '';
    if (pane.modelLabel) {
      meta += (meta ? ' · ' : '') + pane.modelLabel;
    }
    if (pane.claimEnteredAtMs) {
      meta += (meta ? ' · ' : '') + formatClaimEnteredAgo(pane.claimEnteredAtMs);
    }
    if (meta) {
      html += '<div class="ticket-strip-meta">' + escapeHtml(meta) + '</div>';
    }
    return html;
  }

  function buildFullscreenHeadHtml(pane, label, paneId, showClaimEntered) {
    if (!pane || pane.available === false) {
      return buildPaneHeadHtml(null, label, paneId, false);
    }
    // Ticket strip already carries role · model · claim age — no bold pane-kind repeat.
    if (pane.ticketId) {
      return buildTicketBlockHtml(pane);
    }
    return buildPaneHeadHtml(pane, label, paneId, showClaimEntered);
  }

  function applyFullscreenMode() {
    var active = !!focusPane;
    document.body.classList.toggle('pane-fullscreen-active', active);
    paneFullscreenEl.hidden = !active;
    if (active) {
      syncFullscreenContent();
      syncFullscreenStatusDot();
      enterImmersiveFullscreen();
      applyViewportHeight();
      if (tg && typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
    } else {
      exitImmersiveFullscreen();
      if (tg && typeof tg.enableVerticalSwipes === 'function') tg.enableVerticalSwipes();
    }
  }

  function syncFullscreenContent() {
    if (!focusPane) return;
    var entry = paneEntryById(focusPane);
    if (!entry) return;
    var pane = entry.pane;
    var showClaim = true;
    fsHeadEl.innerHTML = buildFullscreenHeadHtml(pane, entry.label, entry.id, showClaim);
    if (pane && pane.claimEnteredAtMs) {
      fsClaimEnteredAtMs = pane.claimEnteredAtMs;
      fsTitleBase = '';
    } else {
      fsClaimEnteredAtMs = null;
      fsTitleBase = '';
    }
    var text = pane && pane.available !== false ? (pane.paneText || '(empty)') : '(pane not reachable)';
    if (fsPreEl.textContent !== text) {
      var atBottom = fsPreEl.scrollHeight - fsPreEl.scrollTop - fsPreEl.clientHeight < 24;
      fsPreEl.textContent = text;
      if (atBottom) fsPreEl.scrollTop = fsPreEl.scrollHeight;
    }
  }

  function enterFullscreen(paneId) {
    focusPane = paneId;
    applyFullscreenMode();
  }

  function exitFullscreen() {
    focusPane = null;
    applyFullscreenMode();
    updateTicketStrip(lastPanes);
  }

  // A tap ANYWHERE in a tile expands it, not just the head strip - the pane
  // text is the part you are actually looking at when you decide you want it
  // bigger, and on a 4-8 tile split the head is a small target. Mirrors the
  // fullscreen overlay's own tap-to-exit below, selection guard included: a
  // drag-scroll of the mini pre never fires click, but a long-press text
  // selection can, and that must not yank you into fullscreen.
  splitEl.addEventListener('click', function (e) {
    var selection = window.getSelection && window.getSelection();
    if (selection && String(selection).length) return;
    var col = e.target.closest('.pane-col');
    if (!col) return;
    var pane = col.getAttribute('data-pane-id');
    if (!pane) return;
    enterFullscreen(pane);
  });

  paneFullscreenEl.addEventListener('click', function (e) {
    var selection = window.getSelection && window.getSelection();
    if (selection && String(selection).length) return;
    e.preventDefault();
    exitFullscreen();
  });

  // BL-609: stopPropagation so +/- never triggers the fullscreen tap-to-exit.
  fsFontCtrlEl.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    var target = e.target;
    if (target === fsFontIncEl) {
      paneFontSizePx = stepPaneFontSizePx(paneFontSizePx, 1);
      applyPaneFontSize(true);
      return;
    }
    if (target === fsFontDecEl) {
      paneFontSizePx = stepPaneFontSizePx(paneFontSizePx, -1);
      applyPaneFontSize(true);
    }
  });

  function dotClassName(kind, isPaneTile) {
    var base = isPaneTile ? 'dot pane-status-dot' : 'dot';
    return base + (kind === 'ok' ? '' : ' ' + kind);
  }

  function applyDotState(dotEl, kind) {
    if (!dotEl) return;
    dotEl.removeAttribute('hidden');
    dotEl.hidden = false;
    dotEl.className = dotClassName(kind, dotEl.hasAttribute('data-status-indicator'));
  }

  function hideDot(dotEl) {
    if (!dotEl) return;
    dotEl.hidden = true;
    dotEl.setAttribute('hidden', '');
    dotEl.className = dotEl.hasAttribute('data-status-indicator') ? 'dot pane-status-dot' : 'dot';
  }

  function resolvePaneStatusKind(pane, aggregateKind) {
    // BL-1243 scenario 06: a FAILED poll outranks every per-pane signal. This
    // view repaints the last snapshot's panes when a poll fails, and the
    // per-pane signal is consulted before anything else - so a tile that was
    // busy at the moment the bridge went down would stay green for the whole
    // outage, which is the one moment the operator most needs the grid to stop
    // claiming things. Scoped to 'err' deliberately: a merely STALE aggregate
    // still yields to the pane's own answer, because "the poll is a bit old"
    // is not "we have lost contact".
    if (aggregateKind === 'err') {
      return aggregateKind;
    }
    if (pane && pane.activitySignal) {
      return pane.activitySignal;
    }
    if (!pane || pane.available === false) {
      return null;
    }
    return aggregateKind;
  }

  function updatePaneStatusDot(headEl, pane, aggregateKind) {
    var dotEl = headEl.querySelector('[data-status-indicator]');
    if (!dotEl) return;
    var kind = resolvePaneStatusKind(pane, aggregateKind);
    if (!kind) {
      hideDot(dotEl);
      return;
    }
    applyDotState(dotEl, kind);
  }

  function updateAllPaneStatusDots(aggregateKind) {
    var cols = splitEl.querySelectorAll('.pane-col');
    for (var i = 0; i < lastPanes.length; i++) {
      var col = cols[i];
      if (!col) continue;
      var headEl = col.querySelector('.pane-head');
      if (!headEl) continue;
      updatePaneStatusDot(headEl, lastPanes[i].pane, aggregateKind);
    }
  }

  function syncFullscreenStatusDot() {
    if (!focusPane || paneFullscreenEl.hidden) {
      hideDot(fsDotEl);
      return;
    }
    var entry = paneEntryById(focusPane);
    var kind = resolvePaneStatusKind(entry && entry.pane, lastAggregateStatus);
    if (!kind) {
      hideDot(fsDotEl);
      return;
    }
    applyDotState(fsDotEl, kind);
  }

  function setStatus(kind) {
    lastAggregateStatus = kind;
    updateAllPaneStatusDots(kind);
    syncFullscreenStatusDot();
  }

  function tickAge() {
    if (!lastOk) return;
    var s = Math.round((Date.now() - lastOk) / 1000);
    setStatus(s > 5 ? 'stale' : 'ok');
  }

  function formatClaimEnteredAgo(claimEnteredAtMs) {
    var elapsedSec = Math.max(0, Math.floor((Date.now() - claimEnteredAtMs) / 1000));
    if (elapsedSec < 60) return 'entered ' + elapsedSec + 's ago';
    var elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return 'entered ' + elapsedMin + 'm ago';
    var elapsedHr = Math.floor(elapsedMin / 60);
    if (elapsedHr < 48) return 'entered ' + elapsedHr + 'h ago';
    return 'entered ' + Math.floor(elapsedHr / 24) + 'd ago';
  }

  function formatClaimAgeCompact(claimEnteredAtMs) {
    var elapsedSec = Math.max(0, Math.floor((Date.now() - claimEnteredAtMs) / 1000));
    if (elapsedSec < 60) return elapsedSec + 's';
    var elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return elapsedMin + 'm';
    var elapsedHr = Math.floor(elapsedMin / 60);
    if (elapsedHr < 48) return elapsedHr + 'h';
    return Math.floor(elapsedHr / 24) + 'd';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizePanes(data) {
    if (data.panes && data.panes.length) {
      return data.panes;
    }
    return [
      { id: 'resident', label: 'Resident', pane: data.resident || { available: false } },
      { id: 'coordinator', label: 'Coordinator', pane: data.coordinator || { available: false } }
    ];
  }

  function updateOfflineBanner(panes, available) {
    if (focusPane) {
      paneOfflineEl.hidden = true;
      return;
    }
    var anyLive = !!available && panes.some(function (entry) {
      return entry.pane && entry.pane.available !== false;
    });
    paneOfflineEl.hidden = anyLive;
  }

  function pickTicketPane(panes) {
    for (var j = 0; j < panes.length; j++) {
      if ((panes[j].id === 'resident' || panes[j].id === 'coder') && panes[j].pane && panes[j].pane.ticketId) {
        return panes[j].pane;
      }
    }
    for (var k = 0; k < panes.length; k++) {
      if (panes[k].pane && panes[k].pane.ticketId) {
        return panes[k].pane;
      }
    }
    return null;
  }

  function updateTicketStrip(panes) {
    if (focusPane) return;
    if (!lastMonoRouterLayout) {
      ticketStripEl.hidden = true;
      ticketStripClaimEnteredAtMs = null;
      ticketStripMetaBase = '';
      return;
    }
    var pane = pickTicketPane(panes);
    if (!pane || !pane.ticketId) {
      ticketStripEl.hidden = true;
      ticketStripClaimEnteredAtMs = null;
      ticketStripMetaBase = '';
      return;
    }
    ticketStripEl.hidden = false;
    ticketStripIdEl.textContent = pane.ticketId;
    ticketStripTitleEl.textContent = pane.ticketTitle || '(untitled)';
    ticketStripClaimEnteredAtMs = pane.claimEnteredAtMs || null;
    var meta = pane.roleLabel || '';
    if (pane.modelLabel) {
      meta += (meta ? ' · ' : '') + pane.modelLabel;
    }
    ticketStripMetaBase = meta;
    if (ticketStripClaimEnteredAtMs) {
      meta += (meta ? ' · ' : '') + formatClaimEnteredAgo(ticketStripClaimEnteredAtMs);
    }
    ticketStripMetaEl.textContent = meta;
    ticketStripMetaEl.hidden = !meta;
  }

  function ensurePaneColumns(panes) {
    var ids = panes.map(function (p) { return p.id; }).join(',');
    if (splitEl.getAttribute('data-pane-ids') === ids) {
      return;
    }
    splitEl.setAttribute('data-pane-ids', ids);
    splitEl.className = 'split pane-count-' + panes.length;
    splitEl.innerHTML = '';
    focusPane = null;
    paneFullscreenEl.hidden = true;
    document.body.classList.remove('pane-fullscreen-active');
    for (var i = 0; i < panes.length; i++) {
      var entry = panes[i];
      var col = document.createElement('section');
      col.className = 'pane-col';
      col.setAttribute('data-pane-id', entry.id);
      var head = document.createElement('div');
      head.className = 'pane-head';
      var pre = document.createElement('pre');
      col.appendChild(head);
      col.appendChild(pre);
      splitEl.appendChild(col);
    }
  }

  function buildGridTileHeadHtml(pane, label) {
    var html = '<div class="pane-head-main"><div class="pane-kind">' + escapeHtml(label) + '</div>';
    if (pane && pane.available !== false && pane.ticketId) {
      html += '<div class="pane-grid-ticket">';
      html += '<span class="pane-grid-ticket-id">' + escapeHtml(pane.ticketId) + '</span>';
      if (pane.ticketTitle) {
        html += '<span class="pane-grid-slug">' + escapeHtml(pane.ticketTitle) + '</span>';
      }
      if (pane.claimEnteredAtMs) {
        html += '<span class="pane-grid-age">' + escapeHtml(formatClaimAgeCompact(pane.claimEnteredAtMs)) + '</span>';
      }
      if (pane.heldParcelCount && pane.heldParcelCount > 1) {
        html += '<span class="pane-grid-more">+' + (pane.heldParcelCount - 1) + '</span>';
      }
      html += '</div>';
    }
    html += '</div><span class="pane-expand-hint">Expand</span>';
    html += '<span class="dot pane-status-dot" data-status-indicator hidden aria-hidden="true"></span>';
    return html;
  }

  function renderPane(pane, headEl, paneEl, label, paneId) {
    // BL-1046: grid tile reads the same payload fields as fullscreen Expand.
    headEl.innerHTML = buildGridTileHeadHtml(pane, label);
    if (pane && pane.activitySignal) {
      updatePaneStatusDot(headEl, pane, 'ok');
    } else if (lastAggregateStatus) {
      updatePaneStatusDot(headEl, pane, lastAggregateStatus);
    }
    if (pane && pane.claimEnteredAtMs) {
      claimEnteredByPaneId[paneId] = pane.claimEnteredAtMs;
    } else {
      delete claimEnteredByPaneId[paneId];
    }
    // Keep pane text in the hidden <pre> so Expand can still use DOM if needed;
    // fullscreen sync reads from the live payload, not this node.
    if (!pane || pane.available === false) {
      paneEl.textContent = '(pane not reachable)';
      return;
    }
    var text = pane.paneText || '(empty)';
    if (paneEl.textContent !== text) {
      paneEl.textContent = text;
    }
  }

  function renderAllPanes(panes) {
    ensurePaneColumns(panes);
    var cols = splitEl.querySelectorAll('.pane-col');
    for (var i = 0; i < panes.length; i++) {
      var col = cols[i];
      if (!col) continue;
      renderPane(
        panes[i].pane,
        col.querySelector('.pane-head'),
        col.querySelector('pre'),
        panes[i].label,
        panes[i].id
      );
    }
    updateTicketStrip(panes);
    updateOfflineBanner(panes, lastFetchAvailable);
    if (lastAggregateStatus) {
      updateAllPaneStatusDots(lastAggregateStatus);
    }
    if (focusPane) {
      syncFullscreenContent();
    }
  }

  function refresh() {
    fetch('/resident-pane?bearer=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) {
          setStatus('err');
          return;
        }
        var panes = normalizePanes(data);
        lastPanes = panes;
        lastFetchAvailable = !!data.available;
        lastMonoRouterLayout = !!data.monoRouterLayout;
        renderAllPanes(panes);
        if (!data.available) {
          setStatus('err');
        } else {
          lastOk = Date.now();
          setStatus('ok');
        }
      })
      .catch(function () {
        setStatus('err');
      });
  }

  loadPaneFontSize();
  refresh();
  // BL-881: paired with RESIDENT_PANE_CACHE_TTL_MS (residentPaneLive.ts) —
  // polling faster than the walk can finish piled overlapping captures onto
  // the bridge's single event-loop thread and wedged it.
  setInterval(refresh, 4000);
  setInterval(tickAge, 500);
  setInterval(function () {
    for (var paneId in claimEnteredByPaneId) {
      if (!Object.prototype.hasOwnProperty.call(claimEnteredByPaneId, paneId)) continue;
      var col = splitEl.querySelector('.pane-col[data-pane-id="' + paneId + '"]');
      if (col) {
        var titleEl = col.querySelector('.pane-title');
        if (titleEl) {
          var base = titleEl.textContent.replace(/ · entered .*$/, '');
          titleEl.textContent = base + ' · ' + formatClaimEnteredAgo(claimEnteredByPaneId[paneId]);
        }
        var gridAgeEl = col.querySelector('.pane-grid-age');
        if (gridAgeEl) {
          gridAgeEl.textContent = formatClaimAgeCompact(claimEnteredByPaneId[paneId]);
        }
      }
      if (focusPane === paneId && fsClaimEnteredAtMs) {
        var fsMetaEl = fsHeadEl.querySelector('.ticket-strip-meta');
        if (fsMetaEl) {
          var fsMetaBase = fsMetaEl.textContent.replace(/ · entered .*$/, '');
          fsMetaEl.textContent = fsMetaBase + ' · ' + formatClaimEnteredAgo(claimEnteredByPaneId[paneId]);
        }
      }
    }
    if (ticketStripClaimEnteredAtMs && !ticketStripEl.hidden) {
      ticketStripMetaEl.textContent = ticketStripMetaBase
        ? ticketStripMetaBase + ' · ' + formatClaimEnteredAgo(ticketStripClaimEnteredAtMs)
        : formatClaimEnteredAgo(ticketStripClaimEnteredAtMs);
    }
    if (fsClaimEnteredAtMs && !paneFullscreenEl.hidden) {
      var fsMetaEl = fsHeadEl.querySelector('.ticket-strip-meta');
      if (fsMetaEl) {
        var fsMetaBase = fsMetaEl.textContent.replace(/ · entered .*$/, '');
        fsMetaEl.textContent = fsMetaBase + ' · ' + formatClaimEnteredAgo(fsClaimEnteredAtMs);
      }
    }
  }, 1000);
})();
</script>
</body>
</html>`;
}
