const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PaneTailer, normalizePaneRows } = require('../out/panel/paneTailer');
const { installFakeTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fitpane-'));
}

function writeState(targetPath, roleLines = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n') {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

test('normalizePaneRows clamps to MIN_TILE_PANE_ROWS (6)', () => {
  assert.equal(normalizePaneRows(3), 6);
  assert.equal(normalizePaneRows(1), 6);
  assert.equal(normalizePaneRows(0), 200);
  assert.equal(normalizePaneRows(null), 200);
});

test('normalizePaneRows clamps to MAX_TILE_PANE_ROWS (1000)', () => {
  assert.equal(normalizePaneRows(1500), 1000);
  assert.equal(normalizePaneRows(2000), 1000);
});

test('normalizePaneRows accepts values within bounds', () => {
  assert.equal(normalizePaneRows(10), 10);
  assert.equal(normalizePaneRows(50), 50);
  assert.equal(normalizePaneRows(100), 100);
  assert.equal(normalizePaneRows(500), 500);
});

test('normalizePaneRows defaults to DEFAULT_TILE_PANE_ROWS (200) for null/undefined', () => {
  assert.equal(normalizePaneRows(null), 200);
  assert.equal(normalizePaneRows(undefined), 200);
});

test('PaneTailer.updatePaneRows applies new pane rows via applyPaneSettings', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    let resizeWindowCalls = [];
    const origResizeWindow = require('../out/swarm/tmuxClient').resizeWindow;
    require('../out/swarm/tmuxClient').resizeWindow = (socket, session, cols, rows) => {
      resizeWindowCalls.push({ socket, session, cols, rows });
    };

    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    resizeWindowCalls = [];

    tailer.updatePaneRows(42);

    assert.equal(resizeWindowCalls.length, 1);
    assert.equal(resizeWindowCalls[0].rows, 42);

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.updatePaneRows normalizes the value via normalizePaneRows', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    let resizeWindowCalls = [];
    const origResizeWindow = require('../out/swarm/tmuxClient').resizeWindow;
    require('../out/swarm/tmuxClient').resizeWindow = (socket, session, cols, rows) => {
      resizeWindowCalls.push({ socket, session, cols, rows });
    };

    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    resizeWindowCalls = [];

    tailer.updatePaneRows(3);

    assert.equal(resizeWindowCalls.length, 1);
    assert.equal(resizeWindowCalls[0].rows, 6);

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.updatePaneRows skips applyPaneSettings if value unchanged', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    let resizeWindowCalls = [];
    const origResizeWindow = require('../out/swarm/tmuxClient').resizeWindow;
    require('../out/swarm/tmuxClient').resizeWindow = (socket, session, cols, rows) => {
      resizeWindowCalls.push({ socket, session, cols, rows });
    };

    const tailer = new PaneTailer(targetPath, () => {}, undefined, undefined, undefined, undefined, undefined, 50);
    tailer.refreshState();
    resizeWindowCalls = [];

    tailer.updatePaneRows(50);

    assert.equal(resizeWindowCalls.length, 0, 'should skip if paneRows unchanged');

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});
