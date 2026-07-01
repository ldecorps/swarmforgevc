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

test('PaneTailer.updatePaneRows resizes only the reporting role\'s pane', () => {
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

    tailer.updatePaneRows('coder', 42);

    assert.equal(resizeWindowCalls.length, 1);
    assert.equal(resizeWindowCalls[0].session, 'swarmforge-coder');
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

    tailer.updatePaneRows('coder', 3);

    assert.equal(resizeWindowCalls.length, 1);
    assert.equal(resizeWindowCalls[0].rows, 6);

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.updatePaneRows skips resizing if value unchanged for that role', () => {
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

    tailer.updatePaneRows('coder', 50);
    assert.equal(resizeWindowCalls.length, 1);
    resizeWindowCalls = [];

    tailer.updatePaneRows('coder', 50);
    assert.equal(resizeWindowCalls.length, 0, 'should skip if that role\'s paneRows unchanged');

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.updatePaneRows is per-role: sizing one role does not resize others', () => {
  const targetPath = mkTmp();
  writeState(
    targetPath,
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
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

    // The selected tile (coder) measures much taller than the unselected one
    // (cleaner) -- each must be resized to its OWN measured height, not a
    // shared value overwriting both panes.
    tailer.updatePaneRows('coder', 80);
    tailer.updatePaneRows('cleaner', 20);

    assert.equal(resizeWindowCalls.length, 2);
    assert.deepEqual(
      resizeWindowCalls.map((c) => ({ session: c.session, rows: c.rows })),
      [
        { session: 'swarmforge-coder', rows: 80 },
        { session: 'swarmforge-cleaner', rows: 20 },
      ]
    );

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.applyPaneSettings preserves each role\'s own reported pane rows on refresh', () => {
  const targetPath = mkTmp();
  writeState(
    targetPath,
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    let resizeWindowCalls = [];
    const origResizeWindow = require('../out/swarm/tmuxClient').resizeWindow;
    require('../out/swarm/tmuxClient').resizeWindow = (socket, session, cols, rows) => {
      resizeWindowCalls.push({ socket, session, cols, rows });
    };

    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    tailer.updatePaneRows('coder', 80);
    tailer.updatePaneRows('cleaner', 20);
    resizeWindowCalls = [];

    // Simulate a role-set refresh (e.g. respawn) re-applying pane settings.
    tailer.refreshState();

    const rowsBySession = Object.fromEntries(
      resizeWindowCalls.map((c) => [c.session, c.rows])
    );
    assert.equal(rowsBySession['swarmforge-coder'], 80);
    assert.equal(rowsBySession['swarmforge-cleaner'], 20);

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});

test('PaneTailer.updatePaneRows is a no-op when the role is unknown', () => {
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

    tailer.updatePaneRows('nonexistent-role', 42);

    assert.equal(resizeWindowCalls.length, 0);

    require('../out/swarm/tmuxClient').resizeWindow = origResizeWindow;
  } finally {
    fake.restore();
  }
});
