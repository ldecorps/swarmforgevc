const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmuxClient = require('../out/swarm/tmuxClient');
const { PaneTailer } = require('../out/panel/paneTailer');

// BL-070: tiles retain scrollback memory beyond the visible pane rows.
//
// This drives the REAL PaneTailer through a sequence of tmux capture-pane
// results shaped exactly like the diagnosed regression — a small
// alternate-screen window (a handful of visible rows, tmux history_size
// permanently 0) that only ever shows the CURRENT tail of a much longer
// transcript. It asserts on the actual retained/rendered text reaching
// onOutput, not on the tmux argv used to request the capture.
//
// BL-124/BL-125: the tmux double is now IN-PROCESS. The previous helper
// installed a fake `tmux` executable on PATH, so every PaneTailer.poll()
// spawned a node subprocess (has-session + capture-pane + display-message);
// at 15-25 polls per test that was 30s+ and made the suite time out. Here we
// spy the spawn-backed tmuxClient functions (PaneTailer calls them as
// tmuxClient_1.fn(...), so a spy on the module object intercepts them) and
// feed the captured window via a shared mutable — identical behavior, in
// milliseconds, with no real timers and no subprocesses.
let capturedWindow = '';
beforeEach(() => {
  vi.spyOn(tmuxClient, 'sessionExists').mockReturnValue(true);
  vi.spyOn(tmuxClient, 'getPaneBaseIndex').mockReturnValue(0);
  vi.spyOn(tmuxClient, 'getPaneCommand').mockReturnValue('claude');
  vi.spyOn(tmuxClient, 'capturePane').mockImplementation(() => ({ stdout: capturedWindow, exitCode: 0, stderr: '' }));
  vi.spyOn(tmuxClient, 'resizeWindow').mockImplementation(() => {});
  vi.spyOn(tmuxClient, 'setHistoryLimit').mockImplementation(() => {});
  vi.spyOn(tmuxClient, 'setWindowSizeManual').mockImplementation(() => {});
  vi.spyOn(tmuxClient, 'sendKeys').mockImplementation(() => ({ exitCode: 0, stdout: '', stderr: '' }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-panetailer-scrollback-'));
}

function writeState(targetPath, roleLines = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n') {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

// A tiny alt-screen-shaped "window": 3 content lines plus a stable footer
// prompt line, matching the diagnosed live shape (small pane_height,
// history_size 0) far more closely than a single long capture would.
function windowAt(n) {
  const contentLines = [n - 2, n - 1, n].filter((i) => i >= 0).map((i) => `line${i}`);
  return [...contentLines, '❯ '].join('\n');
}

test('BL-070: content that has scrolled off the visible window is still reachable in the retained transcript', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  capturedWindow = windowAt(0);

  const updates = [];
  const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
  tailer.start(1_000_000); // one synchronous poll only; we drive the rest by hand
  tailer.stop();

  // Simulate the pane scrolling forward one line at a time, as a real TUI
  // would as the agent prints output — each capture only ever shows the
  // CURRENT 3-line window plus the footer, exactly like the diagnosed
  // 7-row alternate-screen pane.
  for (let n = 1; n <= 15; n++) {
    capturedWindow = windowAt(n);
    tailer.poll();
  }

  const latest = updates[updates.length - 1].text;

  // The most recent capture alone would only ever show line13/14/15 plus
  // the footer — that's the exact symptom reported (only the last few
  // lines, scrolling up reveals nothing). The retained transcript must
  // reach much further back than that.
  assert.match(latest, /line0\b/, 'the earliest line must still be reachable — this is the actual regression test');
  assert.match(latest, /line8\b/, 'a middle line, long since scrolled off the visible window, must also be reachable');
  assert.match(latest, /line15\b/, 'the current live line must still be present');
  assert.ok(latest.trimEnd().endsWith('❯'), 'the footer stays pinned at the end of the retained transcript');
});

// BL-070 tile-memory-02: retained history is bounded by the historyLines setting
test('BL-070: retained history is bounded by historyLines even across many scroll steps', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  capturedWindow = windowAt(0);

  const updates = [];
  // A small cap (10 lines) so the boundary is reachable in a short test.
  const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 10);
  tailer.start(1_000_000);
  tailer.stop();

  for (let n = 1; n <= 25; n++) {
    capturedWindow = windowAt(n);
    tailer.poll();
  }

  const latest = updates[updates.length - 1].text;
  const lineCount = latest.split('\n').length;

  assert.ok(lineCount <= 11, `retained transcript (+footer) must stay near the 10-line cap, got ${lineCount} lines`);
  assert.doesNotMatch(latest, /line0\b/, 'content far older than the cap must have been trimmed');
  assert.match(latest, /line25\b/, 'the current live line is always retained');
});

// BL-070 tile-memory-05: an unchanged screen does not multiply history, end to end
test('BL-070: a pane that repaints the same content across many polls does not grow the retained transcript', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  capturedWindow = windowAt(5);

  const updates = [];
  const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
  tailer.start(1_000_000);
  tailer.stop();
  const afterFirstPoll = updates.length;

  for (let i = 0; i < 20; i++) {
    tailer.poll(); // identical capture-pane output every time
  }

  assert.equal(
    updates.length,
    afterFirstPoll,
    'an unchanged capture must not produce further onOutput updates at all'
  );
});
