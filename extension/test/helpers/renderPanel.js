const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { getWebviewHtml } = require('../../out/panel/webviewHtml');

const PANEL_JS_PATH = path.join(__dirname, '../../media/panel.js');

// Renders the REAL webview HTML shell (getWebviewHtml) and evaluates the
// REAL media/panel.js source inside a jsdom window, so tests assert on
// browser-visible markup instead of a hand-copied restatement of the
// rendering logic (BL-068's hard requirement: a state-only unit test is not
// sufficient to prove a tile header actually renders a badge).
function renderPanel() {
  const html = getWebviewHtml('vscode-webview://dummy/panel.js', 'vscode-webview:');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  const sentMessages = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => { sentMessages.push(message); },
    getState: () => undefined,
    setState: () => {},
  });
  // jsdom does not implement ResizeObserver; panel.js only uses it to react
  // to live tile resizes, which rendered-markup assertions don't exercise.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const panelSource = fs.readFileSync(PANEL_JS_PATH, 'utf8');
  dom.window.eval(panelSource);

  function dispatch(message) {
    window.dispatchEvent(new window.MessageEvent('message', { data: message }));
  }

  return { window, document: window.document, dispatch, sentMessages };
}

module.exports = { renderPanel };
