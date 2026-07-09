const assert = require('node:assert/strict');
const { mapInputToTmuxKey, mapSpecialKeyToTmux, normalizeHistoryLines } = require('../out/panel/paneTailer');
const { stripAnsi } = require('../out/panel/ansi');
const { getPaneCommand } = require('../out/swarm/tmuxClient');

test('getPaneCommand returns empty string for non-existent socket', () => {
  const result = getPaneCommand('/tmp/nonexistent-sfvc-socket-xyz', 'somesession:0.0');
  assert.equal(result, '');
});

test('stripAnsi removes basic SGR sequences', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

test('stripAnsi removes bold and reset sequences', () => {
  assert.equal(stripAnsi('\x1b[1mhello\x1b[0m world'), 'hello world');
});

test('stripAnsi passes plain text through unchanged', () => {
  assert.equal(stripAnsi('plain text'), 'plain text');
});

test('stripAnsi removes cursor positioning sequences', () => {
  assert.equal(stripAnsi('\x1b[2Jhello'), 'hello');
});

test('mapInputToTmuxKey maps CR to Enter', () => {
  assert.deepEqual(mapInputToTmuxKey('\r'), { key: 'Enter', literal: false });
});

test('mapInputToTmuxKey maps LF to Enter', () => {
  assert.deepEqual(mapInputToTmuxKey('\n'), { key: 'Enter', literal: false });
});

test('mapInputToTmuxKey maps DEL (0x7f) to BSpace', () => {
  assert.deepEqual(mapInputToTmuxKey('\x7f'), { key: 'BSpace', literal: false });
});

test('mapInputToTmuxKey maps BS (0x08) to BSpace', () => {
  assert.deepEqual(mapInputToTmuxKey('\b'), { key: 'BSpace', literal: false });
});

test('mapInputToTmuxKey maps tab to Tab', () => {
  assert.deepEqual(mapInputToTmuxKey('\t'), { key: 'Tab', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+A (0x01) to C-a', () => {
  assert.deepEqual(mapInputToTmuxKey('\x01'), { key: 'C-a', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+C (0x03) to C-c', () => {
  assert.deepEqual(mapInputToTmuxKey('\x03'), { key: 'C-c', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+Z (0x1a) to C-z', () => {
  assert.deepEqual(mapInputToTmuxKey('\x1a'), { key: 'C-z', literal: false });
});

test('mapInputToTmuxKey passes printable text through as literal', () => {
  assert.deepEqual(mapInputToTmuxKey('hello'), { key: 'hello', literal: true });
});

test('mapInputToTmuxKey passes single printable char through as literal', () => {
  assert.deepEqual(mapInputToTmuxKey('a'), { key: 'a', literal: true });
});

test('mapSpecialKeyToTmux maps Enter', () => {
  assert.equal(mapSpecialKeyToTmux('Enter'), 'Enter');
});

test('mapSpecialKeyToTmux maps Backspace to BSpace', () => {
  assert.equal(mapSpecialKeyToTmux('Backspace'), 'BSpace');
});

test('mapSpecialKeyToTmux maps Tab', () => {
  assert.equal(mapSpecialKeyToTmux('Tab'), 'Tab');
});

test('mapSpecialKeyToTmux maps Escape', () => {
  assert.equal(mapSpecialKeyToTmux('Escape'), 'Escape');
});

test('mapSpecialKeyToTmux maps ArrowUp to Up', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowUp'), 'Up');
});

test('mapSpecialKeyToTmux maps ArrowDown to Down', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowDown'), 'Down');
});

test('mapSpecialKeyToTmux maps ArrowLeft to Left', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowLeft'), 'Left');
});

test('mapSpecialKeyToTmux maps ArrowRight to Right', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowRight'), 'Right');
});

test('mapSpecialKeyToTmux maps Home', () => {
  assert.equal(mapSpecialKeyToTmux('Home'), 'Home');
});

test('mapSpecialKeyToTmux maps End', () => {
  assert.equal(mapSpecialKeyToTmux('End'), 'End');
});

test('mapSpecialKeyToTmux maps PageUp to PPage', () => {
  assert.equal(mapSpecialKeyToTmux('PageUp'), 'PPage');
});

test('mapSpecialKeyToTmux maps PageDown to NPage', () => {
  assert.equal(mapSpecialKeyToTmux('PageDown'), 'NPage');
});

test('mapSpecialKeyToTmux maps Delete to DC', () => {
  assert.equal(mapSpecialKeyToTmux('Delete'), 'DC');
});

test('mapSpecialKeyToTmux returns undefined for unknown key', () => {
  assert.equal(mapSpecialKeyToTmux('F1'), undefined);
});

test('mapSpecialKeyToTmux returns undefined for empty string', () => {
  assert.equal(mapSpecialKeyToTmux(''), undefined);
});

const { isStalled, STALL_THRESHOLD_MS, WORKING_INDICATOR_MS } = require('../out/panel/paneTailer');

test('STALL_THRESHOLD_MS is 120000', () => {
  assert.equal(STALL_THRESHOLD_MS, 120_000);
});

test('WORKING_INDICATOR_MS is 30000', () => {
  assert.equal(WORKING_INDICATOR_MS, 30_000);
});

test('isStalled returns false when elapsed < threshold', () => {
  const now = Date.now();
  assert.equal(isStalled(now - 60_000, now), false);
});

test('isStalled returns true when elapsed >= threshold', () => {
  const now = Date.now();
  assert.equal(isStalled(now - 120_000, now), true);
});

test('isStalled returns true when elapsed greatly exceeds threshold', () => {
  const now = Date.now();
  assert.equal(isStalled(now - 300_000, now), true);
});

test('isStalled returns false when lastChangedAt equals now', () => {
  const now = Date.now();
  assert.equal(isStalled(now, now), false);
});

const { DeadEvent } = require('../out/panel/paneTailer');

test('DeadEvent type is exported', () => {
  // DeadEvent is a TypeScript interface; verify the module loads without error
  // and that related exports exist
  const mod = require('../out/panel/paneTailer');
  assert.ok(typeof mod.isStalled === 'function');
  assert.ok(typeof mod.STALL_THRESHOLD_MS === 'number');
});

test('normalizeHistoryLines returns 5000 default when value is undefined', () => {
  assert.equal(normalizeHistoryLines(undefined), 5000);
});

test('normalizeHistoryLines returns 5000 default when value is null', () => {
  assert.equal(normalizeHistoryLines(null), 5000);
});

test('normalizeHistoryLines returns 5000 default when value is <= 0', () => {
  assert.equal(normalizeHistoryLines(0), 5000);
  assert.equal(normalizeHistoryLines(-100), 5000);
});

test('normalizeHistoryLines returns input when value is positive and below cap', () => {
  assert.equal(normalizeHistoryLines(200), 200);
  assert.equal(normalizeHistoryLines(10000), 10000);
});

test('normalizeHistoryLines caps at 50000', () => {
  assert.equal(normalizeHistoryLines(60000), 50000);
  assert.equal(normalizeHistoryLines(50001), 50000);
});

// --- rolesChanged: detect role-set changes (e.g. QA added on respawn) ---

const { rolesChanged } = require('../out/panel/paneTailer');

const r = (name) => ({ role: name, session: `swarmforge-${name}`, displayName: name });

test('rolesChanged returns false for identical role sets', () => {
  assert.equal(rolesChanged([r('coder'), r('cleaner')], [r('coder'), r('cleaner')]), false);
});

test('rolesChanged returns false when order differs but set is the same', () => {
  assert.equal(rolesChanged([r('coder'), r('cleaner')], [r('cleaner'), r('coder')]), false);
});

test('rolesChanged returns true when a role is added (QA appended)', () => {
  const before = [r('coordinator'), r('specifier'), r('coder'), r('cleaner')];
  const after = [...before, r('QA')];
  assert.equal(rolesChanged(before, after), true);
});

test('rolesChanged returns true when a role is removed', () => {
  const before = [r('coder'), r('cleaner'), r('QA')];
  const after = [r('coder'), r('cleaner')];
  assert.equal(rolesChanged(before, after), true);
});

test('rolesChanged returns true going from empty to populated', () => {
  assert.equal(rolesChanged([], [r('coder')]), true);
});

// --- setHistoryLimit: raise tmux scrollback so tiles retain more memory ---

const { setHistoryLimit, resizeWindow, setWindowSizeManual } = require('../out/swarm/tmuxClient');

test('setHistoryLimit returns a result and does not throw on a dead socket', () => {
  const result = setHistoryLimit('/tmp/nonexistent-sfvc-socket-xyz', 5000);
  assert.ok(typeof result.exitCode === 'number');
  assert.notEqual(result.exitCode, 0);
});

// --- pane sizing: tiles are too short (80x24); make windows taller ---

const { normalizePaneRows } = require('../out/panel/paneTailer');

test('normalizePaneRows returns a tall default well above tmux 24', () => {
  const def = normalizePaneRows(undefined);
  assert.ok(def >= 200, `expected default >= 200, got ${def}`);
  assert.equal(normalizePaneRows(null), def);
  assert.equal(normalizePaneRows(0), def);
  assert.equal(normalizePaneRows(-5), def);
});

test('normalizePaneRows returns input when positive and below cap', () => {
  assert.equal(normalizePaneRows(120), 120);
  assert.equal(normalizePaneRows(500), 500);
});

test('normalizePaneRows caps very large values', () => {
  assert.equal(normalizePaneRows(100000), 1000);
});

test('resizeWindow returns a result and does not throw on a dead socket', () => {
  const result = resizeWindow('/tmp/nonexistent-sfvc-socket-xyz', 'swarmforge-coder', 120, 200);
  assert.ok(typeof result.exitCode === 'number');
  assert.notEqual(result.exitCode, 0);
});

test('setWindowSizeManual returns a result and does not throw on a dead socket', () => {
  const result = setWindowSizeManual('/tmp/nonexistent-sfvc-socket-xyz');
  assert.ok(typeof result.exitCode === 'number');
  assert.notEqual(result.exitCode, 0);
});

// ── decideRoleActivity (pure, BL-210) ─────────────────────────────────────
// Extracted from PaneTailer's private emitActivityEvents (CRAP 93.91,
// ~17% covered - unreachable except through a full timer-driven instance).
// No class, no real clock: a fixed NOW plus a plain RoleActivityStatus
// object per test, mirroring inboxChaser.ts/idleClear.ts's own decideX
// convention.

const { decideRoleActivity } = require('../out/panel/paneTailer');

const ACTIVITY_NOW = new Date('2026-07-09T12:00:00Z').getTime();

function roleActivityStatus(overrides = {}) {
  return {
    command: '',
    rawText: '',
    lastChangedMs: undefined,
    wasWorking: false,
    isDead: false,
    ...overrides,
  };
}

test('pure-decision-01: reads no class instance state and takes nowMs as an explicit parameter', () => {
  assert.equal(decideRoleActivity.length, 2);
});

test('recently-changed pane (within WORKING_INDICATOR_MS) is working', () => {
  const status = roleActivityStatus({ lastChangedMs: ACTIVITY_NOW - (WORKING_INDICATOR_MS - 1) });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, true);
});

test('a pane unchanged for longer than WORKING_INDICATOR_MS, with no active-work command, is not working', () => {
  const status = roleActivityStatus({ lastChangedMs: ACTIVITY_NOW - (WORKING_INDICATOR_MS + 1) });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, false);
});

test('lastChangedMs undefined (never observed) is not working from recency alone', () => {
  const status = roleActivityStatus({ lastChangedMs: undefined });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, false);
});

test('an active-work command/pane text makes a role working regardless of recency', () => {
  // "esc to interrupt" is isAgentActivelyWorking's own busy-footer
  // pattern (agentPaneState.ts's ACTIVELY_PROCESSING) - reusing its real
  // detection, not re-deriving it here.
  const status = roleActivityStatus({
    command: 'node',
    rawText: 'Thinking… (esc to interrupt)',
    lastChangedMs: ACTIVITY_NOW - (WORKING_INDICATOR_MS + 100_000),
  });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, true);
});

test('changed is true only when working differs from wasWorking', () => {
  const becameWorking = roleActivityStatus({ wasWorking: false, lastChangedMs: ACTIVITY_NOW });
  assert.equal(decideRoleActivity(becameWorking, ACTIVITY_NOW).changed, true);

  const staysWorking = roleActivityStatus({ wasWorking: true, lastChangedMs: ACTIVITY_NOW });
  assert.equal(decideRoleActivity(staysWorking, ACTIVITY_NOW).changed, false);

  const staysIdle = roleActivityStatus({ wasWorking: false, lastChangedMs: ACTIVITY_NOW - (WORKING_INDICATOR_MS + 1) });
  assert.equal(decideRoleActivity(staysIdle, ACTIVITY_NOW).changed, false);
});

// dead-role-clears-working-03
test('a role that becomes dead while working emits a not-working, changed decision', () => {
  const status = roleActivityStatus({ isDead: true, wasWorking: true, lastChangedMs: ACTIVITY_NOW });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, false);
  assert.equal(decision.changed, true);
});

test('a role that is dead and was already not working produces no change (no redundant event)', () => {
  const status = roleActivityStatus({ isDead: true, wasWorking: false, lastChangedMs: ACTIVITY_NOW });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, false);
  assert.equal(decision.changed, false);
});

test('a dead role is never working even with an active-work command/recent change (isDead forces false)', () => {
  const status = roleActivityStatus({ isDead: true, command: 'node', rawText: 'Thinking… (esc to interrupt)', lastChangedMs: ACTIVITY_NOW });
  const decision = decideRoleActivity(status, ACTIVITY_NOW);
  assert.equal(decision.working, false);
});
