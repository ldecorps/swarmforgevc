// BL-1153: shared inline Mini App script for host-persisted font size.
import type { WebUiFontSizeSurface } from './webUiFontSizePreference';

export function webUiFontSizeMiniAppScript(options: {
  surface: WebUiFontSizeSurface;
  cssVar: string;
  min: number;
  max: number;
  defaultPx: number;
  step: number;
  decId: string;
  incId: string;
}): string {
  const { surface, cssVar, min, max, defaultPx, step, decId, incId } = options;
  return `
  var FONT_SURFACE = '${surface}';
  var FONT_CSS_VAR = '${cssVar}';
  var FONT_MIN = ${min};
  var FONT_MAX = ${max};
  var FONT_DEFAULT = ${defaultPx};
  var FONT_STEP = ${step};

  function currentFontPx() {
    var raw = document.documentElement.style.getPropertyValue(FONT_CSS_VAR);
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : FONT_DEFAULT;
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

  function persistFontPx(px) {
    if (!token) return;
    fetch('/web-ui-font-size?bearer=' + encodeURIComponent(token), {
      method: 'PUT',
      headers: fontControlAuthHeaders(),
      body: JSON.stringify({ surface: FONT_SURFACE, fontSizePx: px }),
    }).catch(function () {});
  }

  function applyFont(px, persist) {
    var clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    document.documentElement.style.setProperty(FONT_CSS_VAR, clamped + 'px');
    document.getElementById('${decId}').disabled = clamped <= FONT_MIN;
    document.getElementById('${incId}').disabled = clamped >= FONT_MAX;
    if (persist) {
      persistFontPx(clamped);
    }
    return clamped;
  }

  function loadFont() {
    if (!token) {
      applyFont(FONT_DEFAULT, false);
      return;
    }
    fetch('/web-ui-font-size?surface=' + encodeURIComponent(FONT_SURFACE) + '&bearer=' + encodeURIComponent(token), {
      cache: 'no-store',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.success && typeof data.fontSizePx === 'number') {
          applyFont(data.fontSizePx, false);
          return;
        }
        applyFont(FONT_DEFAULT, false);
      })
      .catch(function () { applyFont(FONT_DEFAULT, false); });
  }

  document.getElementById('${decId}').onclick = function () {
    applyFont(currentFontPx() - FONT_STEP, true);
  };
  document.getElementById('${incId}').onclick = function () {
    applyFont(currentFontPx() + FONT_STEP, true);
  };
  loadFont();`;
}
