const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const {
  ingestResidentPaneCapture,
  getResidentPaneHistoryText,
  clearResidentPaneHistory,
  tickResidentPaneHistories,
  ensureResidentPaneHistoryPoller,
  RESIDENT_PANE_HISTORY_LINES,
} = require('../out/bridge/residentPaneHistory');
const { detectFooterLineCount } = require('../out/panel/paneHistory');

test('qwen ➜ status row is treated as a footer (not accumulated content)', () => {
  const text = [
    '  ✓ Shell ready_for_next.sh',
    '    NO_TASK',
    '',
    '  .. Working... (1m · ↑ 1k tokens)',
    '────────────────────────────────────────────────────────────────────────────────',
    '*   Type your message or @path/to/file',
    '────────────────────────────────────────────────────────────────────────────────',
    '  ➜ swarmforgevc · git:(main) · 80.5k Context',
    '  Enter to steer · YOLO mode',
  ].join('\n');
  const footer = detectFooterLineCount(text);
  assert.ok(footer >= 5, `footerCount=${footer}`);
  // Chrome must not re-append on an identical re-capture.
  const root = '/tmp/resident-pane-history-qwen-chrome';
  clearResidentPaneHistory();
  ingestResidentPaneCapture(root, 'coordinator', text);
  const again = ingestResidentPaneCapture(root, 'coordinator', text);
  const rules = again.split('\n').filter((l) => l.includes('Type your message'));
  assert.equal(rules.length, 1, `chrome duplicated: ${rules.length}`);
  clearResidentPaneHistory();
});

test('ingestResidentPaneCapture accumulates scrolled content across captures', () => {
  clearResidentPaneHistory();
  const root = '/tmp/resident-pane-history-accum';
  const first = [
    'A line one',
    'B line two',
    'C line three',
    '  ➜ prompt',
  ].join('\n');
  const second = [
    'B line two',
    'C line three',
    'D line four',
    '  ➜ prompt',
  ].join('\n');
  ingestResidentPaneCapture(root, 'coordinator', first);
  const display = ingestResidentPaneCapture(root, 'coordinator', second);
  assert.match(display, /A line one/);
  assert.match(display, /D line four/);
  assert.equal(getResidentPaneHistoryText(root, 'coordinator'), display);
  // Identical re-capture must not double the body.
  const again = ingestResidentPaneCapture(root, 'coordinator', second);
  assert.equal(again.split('\n').filter((l) => l.includes('D line four')).length, 1);
  clearResidentPaneHistory();
});

test('history is bounded to RESIDENT_PANE_HISTORY_LINES', () => {
  clearResidentPaneHistory();
  const root = '/tmp/resident-pane-history-bound';
  for (let i = 0; i < 20; i++) {
    const frame = [`line${i}`, '  ➜ prompt'].join('\n');
    ingestResidentPaneCapture(root, 'coder', frame, 5);
  }
  const text = getResidentPaneHistoryText(root, 'coder') || '';
  const contentLines = text.split('\n').filter((l) => !l.includes('➜'));
  assert.ok(contentLines.length <= 5, `got ${contentLines.length} content lines`);
  assert.equal(RESIDENT_PANE_HISTORY_LINES, 5000);
  clearResidentPaneHistory();
});

test('tickResidentPaneHistories captures live roles into the store', () => {
  clearResidentPaneHistory();
  const tmp = mkTmpDir('resident-pane-history-tick-');
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake-hist.sock');
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tlocal-model\n2\tcoordinator\tswarmforge-coordinator\tCoordinator\tlocal-model\n'
  );
  const pane = ['hello from pane', '  ➜ prompt'].join('\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: pane },
  ]);
  try {
    tickResidentPaneHistories(tmp);
    assert.match(getResidentPaneHistoryText(tmp, 'coder') || '', /hello from pane/);
    assert.match(getResidentPaneHistoryText(tmp, 'coordinator') || '', /hello from pane/);
  } finally {
    fake.restore();
    clearResidentPaneHistory();
  }
});

test('ensureResidentPaneHistoryPoller is idempotent per target', () => {
  clearResidentPaneHistory();
  const tmp = mkTmpDir('resident-pane-history-poll-');
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake-hist2.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tlocal-model\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'once\n  ➜ p\n' },
  ]);
  try {
    ensureResidentPaneHistoryPoller(tmp, 60_000);
    ensureResidentPaneHistoryPoller(tmp, 60_000);
    assert.match(getResidentPaneHistoryText(tmp, 'coder') || '', /once/);
  } finally {
    fake.restore();
    clearResidentPaneHistory();
  }
});
