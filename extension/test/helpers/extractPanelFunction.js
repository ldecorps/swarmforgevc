const fs = require('node:fs');
const path = require('node:path');

const PANEL_JS_PATH = path.join(__dirname, '../../media/panel.js');

function loadPanelSource() {
  return fs.readFileSync(PANEL_JS_PATH, 'utf8');
}

// Extracts one top-level `function name(...) { ... }` declaration from
// media/panel.js source text and turns it into a callable Function, so
// tests exercise the real webview code instead of a hand-copied restatement
// of its logic that can silently drift from the source it claims to cover.
function extractFunctionFromCode(code, functionName) {
  const regex = new RegExp(`function ${functionName}\\(([^)]*)\\)[^{]*{([^]*?)\\n}`, 'm');
  const match = code.match(regex);
  if (!match) {
    throw new Error(`Function ${functionName} not found`);
  }
  const params = match[1];
  const body = match[2];
  return new Function(...params.split(',').map((p) => p.trim()), body);
}

function extractPanelFunction(functionName) {
  return extractFunctionFromCode(loadPanelSource(), functionName);
}

module.exports = { loadPanelSource, extractFunctionFromCode, extractPanelFunction };
