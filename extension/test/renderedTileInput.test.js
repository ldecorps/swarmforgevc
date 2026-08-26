const assert = require('node:assert/strict');
const { renderPanel } = require('./helpers/renderPanel');

// BL-085: typing into an agent tile's terminal output area must forward
// keystrokes to that agent's pane. Renders the REAL webview HTML shell and
// evaluates the REAL media/panel.js source in jsdom, then simulates an
// operator click followed by a keypress, asserting on the postMessage a
// browser would actually emit — not just the internal activeRole state.

const ROLES = [
  { role: 'coder', displayName: 'Coder', agent: 'claude' },
  { role: 'specifier', displayName: 'Specifier', agent: 'claude' },
];

function tileOutput(document, role) {
  return document.querySelector(`.tile-output[data-role="${role}"]`);
}

// BL-085 tile-input-restored-01
test('clicking inside a tile output area (without a native focus event) forwards a typed character to that role', () => {
  const { window, document, dispatch, sentMessages } = renderPanel();
  dispatch({ type: 'roles', roles: ROLES });

  // jsdom (like some real-world click paths) does not always move
  // document.activeElement on a plain .click() the way form controls do -
  // the click handler itself must establish focus explicitly rather than
  // relying solely on the browser's default click-to-focus behavior.
  tileOutput(document, 'coder').click();

  const evt = new window.KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
  document.dispatchEvent(evt);

  assert.deepEqual(
    JSON.parse(JSON.stringify(sentMessages.filter((m) => m.type === 'input'))),
    [{ type: 'input', role: 'coder', data: 'x' }]
  );
});

// BL-085 tile-input-restored-02
test('clicking a different tile retargets keystrokes to the newly clicked role', () => {
  const { window, document, dispatch, sentMessages } = renderPanel();
  dispatch({ type: 'roles', roles: ROLES });

  tileOutput(document, 'coder').click();
  tileOutput(document, 'specifier').click();

  const evt = new window.KeyboardEvent('keydown', { key: 'y', bubbles: true, cancelable: true });
  document.dispatchEvent(evt);

  assert.deepEqual(
    JSON.parse(JSON.stringify(sentMessages.filter((m) => m.type === 'input'))),
    [{ type: 'input', role: 'specifier', data: 'y' }]
  );
});
