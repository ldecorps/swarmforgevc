const assert = require('node:assert/strict');
const {
  parseMarker,
  isMarkerFresh,
  filterDevHostPids,
  decideNextStep,
  resolveVsCodeBinary,
  buildDevHostLaunchCommand,
} = require('../scripts/bounceLib');

// --- parseMarker ---

test('parseMarker reads timestamp and pid from marker JSON', () => {
  const parsed = parseMarker('{"activatedAt":"2026-07-01T21:00:00.000Z","pid":4242}');
  assert.equal(parsed.pid, 4242);
  assert.equal(parsed.activatedAtMs, Date.parse('2026-07-01T21:00:00.000Z'));
});

test('parseMarker returns null for garbage, missing fields, or bad timestamps', () => {
  assert.equal(parseMarker('not json'), null);
  assert.equal(parseMarker('{}'), null);
  assert.equal(parseMarker('{"activatedAt":"not-a-date","pid":1}'), null);
  assert.equal(parseMarker('{"activatedAt":"2026-07-01T21:00:00Z"}'), null);
  assert.equal(parseMarker(null), null);
});

// --- isMarkerFresh ---

test('a marker written after the baseline is fresh', () => {
  const baseline = Date.parse('2026-07-01T21:00:00Z');
  const marker = '{"activatedAt":"2026-07-01T21:00:05.000Z","pid":1}';
  assert.equal(isMarkerFresh(marker, baseline), true);
});

test('a marker from before the baseline is stale — a blind delay must not pass', () => {
  const baseline = Date.parse('2026-07-01T21:00:00Z');
  const marker = '{"activatedAt":"2026-07-01T20:59:59.000Z","pid":1}';
  assert.equal(isMarkerFresh(marker, baseline), false);
});

test('a missing or unreadable marker is never fresh', () => {
  assert.equal(isMarkerFresh(null, 0), false);
  assert.equal(isMarkerFresh('garbage', 0), false);
});

// --- filterDevHostPids ---

const EXT = '/Users/dev/proj/extension';

test('filterDevHostPids finds the dev-host main process for this extension path', () => {
  const ps = [
    `  101 /Applications/Visual Studio Code.app/Contents/MacOS/Electron --extensionDevelopmentPath=${EXT}`,
    '  102 /Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ].join('\n');
  assert.deepEqual(filterDevHostPids(ps, EXT), [101]);
});

test('filterDevHostPids excludes helper subprocesses (--type=...)', () => {
  const ps = [
    `  101 /Applications/Visual Studio Code.app/Contents/MacOS/Electron --extensionDevelopmentPath=${EXT}`,
    `  103 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer --extensionDevelopmentPath=${EXT}`,
  ].join('\n');
  assert.deepEqual(filterDevHostPids(ps, EXT), [101]);
});

test('filterDevHostPids does not match a different extension path or a prefix collision', () => {
  const ps = [
    '  104 Electron --extensionDevelopmentPath=/Users/dev/other/extension',
    `  105 Electron --extensionDevelopmentPath=${EXT}-fork`,
  ].join('\n');
  assert.deepEqual(filterDevHostPids(ps, EXT), []);
});

test('filterDevHostPids escapes regex metacharacters in the extension path', () => {
  // "+" is a regex quantifier; if the path were used unescaped, "proj+beta"
  // would mean "one or more j", incorrectly matching a path with repeated
  // "j"s instead of requiring the literal "+".
  const ext = '/Users/dev/proj+beta/extension';
  const exactMatch = `  101 Electron --extensionDevelopmentPath=${ext}`;
  const wouldMatchIfUnescaped = '  102 Electron --extensionDevelopmentPath=/Users/dev/projjjbeta/extension';
  assert.deepEqual(filterDevHostPids(exactMatch, ext), [101]);
  assert.deepEqual(filterDevHostPids(wouldMatchIfUnescaped, ext), []);
});

test('filterDevHostPids returns every matching main process (pile-up detection)', () => {
  const ps = [
    `  101 Electron --extensionDevelopmentPath=${EXT}`,
    `  106 Electron --extensionDevelopmentPath=${EXT}`,
  ].join('\n');
  assert.deepEqual(filterDevHostPids(ps, EXT), [101, 106]);
});

// --- decideNextStep: the retry/timeout policy ---

function state(overrides) {
  return {
    markerFresh: false,
    devHostRunning: false,
    attempt: 1,
    maxAttempts: 3,
    attemptElapsedMs: 0,
    attemptTimeoutMs: 15000,
    totalElapsedMs: 0,
    totalTimeoutMs: 60000,
    ...overrides,
  };
}

test('a fresh marker means success', () => {
  const step = decideNextStep(state({ markerFresh: true }));
  assert.equal(step.action, 'success');
});

test('keeps waiting while the attempt window is open', () => {
  const step = decideNextStep(state({ attemptElapsedMs: 5000 }));
  assert.equal(step.action, 'wait');
});

test('BL-058 robust-bounce-03: attempt expired with no dev host running triggers a retry', () => {
  const step = decideNextStep(state({ attemptElapsedMs: 15000, devHostRunning: false, attempt: 1 }));
  assert.equal(step.action, 'retrigger');
});

test('attempt expired but a dev host is up keeps waiting instead of double-triggering', () => {
  const step = decideNextStep(
    state({ attemptElapsedMs: 15000, devHostRunning: true, attempt: 1 })
  );
  assert.equal(step.action, 'wait');
});

test('retries are bounded: exhausted attempts with no dev host fail at the launch-trigger stage', () => {
  const step = decideNextStep(
    state({ attemptElapsedMs: 15000, devHostRunning: false, attempt: 3, maxAttempts: 3 })
  );
  assert.equal(step.action, 'fail');
  assert.equal(step.stage, 'launch-trigger');
});

test('the overall timeout fails at the activation stage even if a host is running', () => {
  const step = decideNextStep(
    state({ totalElapsedMs: 60000, devHostRunning: true, attemptElapsedMs: 1000 })
  );
  assert.equal(step.action, 'fail');
  assert.equal(step.stage, 'activation-timeout');
});

test('a fresh marker wins even at the edge of the overall timeout', () => {
  const step = decideNextStep(state({ markerFresh: true, totalElapsedMs: 60000 }));
  assert.equal(step.action, 'success');
});

// --- resolveVsCodeBinary (BL-361) ---

test('resolveVsCodeBinary picks the darwin default when it is executable', () => {
  const result = resolveVsCodeBinary({
    platform: 'darwin',
    env: {},
    isExecutable: (candidate) => candidate === '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  });
  assert.deepEqual(result, { binary: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' });
});

test('resolveVsCodeBinary falls back to a bare "code" on PATH when no linux default install is found', () => {
  const result = resolveVsCodeBinary({
    platform: 'linux',
    env: {},
    isExecutable: (candidate) => candidate === 'code',
  });
  assert.deepEqual(result, { binary: 'code' });
});

test('resolveVsCodeBinary prefers a platform default over the bare "code" fallback when both are executable', () => {
  const result = resolveVsCodeBinary({
    platform: 'linux',
    env: {},
    isExecutable: () => true,
  });
  assert.notEqual(result.binary, 'code');
});

test('BL-361 scenario 05: an operator-named VSCODE_BIN override is authoritative', () => {
  const result = resolveVsCodeBinary({
    platform: 'linux',
    env: { VSCODE_BIN: '/custom/code' },
    isExecutable: (candidate) => candidate === '/custom/code',
  });
  assert.deepEqual(result, { binary: '/custom/code' });
});

test('an unusable VSCODE_BIN override fails fast instead of silently falling back to a default', () => {
  const result = resolveVsCodeBinary({
    platform: 'linux',
    env: { VSCODE_BIN: '/custom/code' },
    isExecutable: () => false,
  });
  assert.equal(result.error, 'vscode-not-found');
  assert.match(result.message, /\/custom\/code/);
});

test('BL-361 scenario 04: the WSL trap — a resolvable but non-executable candidate fails fast naming the no-usable-VS-Code stage', () => {
  // `command -v code` would succeed here (the Windows binary IS on PATH),
  // but isExecutable simulates the real ENOEXEC failure from the missing
  // WSLInterop binfmt handler - resolution must not treat "resolves" as
  // "usable".
  const result = resolveVsCodeBinary({
    platform: 'linux',
    env: {},
    isExecutable: () => false,
  });
  assert.equal(result.error, 'vscode-not-found');
  assert.equal(typeof result.then, 'undefined', 'resolution is synchronous - it must not wait out any timeout to fail');
});

// --- buildDevHostLaunchCommand (BL-361) ---

test('buildDevHostLaunchCommand asks the named VS Code binary to open the extension in development mode', () => {
  const cmd = buildDevHostLaunchCommand('/path/to/code', '/repo/extension', '/repo/extension/swarmforge-vc.code-workspace');
  assert.equal(cmd.command, '/path/to/code');
  assert.deepEqual(cmd.args, ['--extensionDevelopmentPath=/repo/extension', '/repo/extension/swarmforge-vc.code-workspace']);
});

test('buildDevHostLaunchCommand never uses GUI keystroke automation (no open, no osascript)', () => {
  const cmd = buildDevHostLaunchCommand('/path/to/code', '/repo/extension', '/repo/extension/swarmforge-vc.code-workspace');
  assert.notEqual(cmd.command, 'open');
  assert.notEqual(cmd.command, 'osascript');
  assert.ok(!cmd.args.some((arg) => /osascript|key code|System Events/.test(arg)));
});
