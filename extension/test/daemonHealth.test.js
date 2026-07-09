const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readDaemonHealth, computeDaemonProcessStatus } = require('../out/swarm/daemonHealth');
const { loadPanelSource } = require('./helpers/extractPanelFunction');
const { getWebviewHtml } = require('../out/panel/webviewHtml');

// BL-061 supervise-handoffd-06: the extension renders transport health from
// .swarmforge/daemon/handoffd.status.json — view only, never managing the
// daemon process.

function mkTarget(statusJson) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-daemon-health-'));
  if (statusJson !== undefined) {
    const dir = path.join(target, '.swarmforge', 'daemon');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'handoffd.status.json'), statusJson);
  }
  return target;
}

test('readDaemonHealth reports healthy from the status file', () => {
  const target = mkTarget('{"state":"healthy","updated_at":"2026-07-01T23:00:00Z"}');
  assert.deepEqual(readDaemonHealth(target), { state: 'healthy' });
});

test('readDaemonHealth reports restarting with the incident reason', () => {
  const target = mkTarget(
    '{"state":"restarting","last_incident":{"reason":"stalled","at":"2026-07-01T23:00:00Z"}}'
  );
  const health = readDaemonHealth(target);
  assert.equal(health.state, 'restarting');
  assert.equal(health.detail, 'stalled');
});

test('readDaemonHealth reports persistent-failure', () => {
  const target = mkTarget(
    '{"state":"persistent-failure","last_incident":{"reason":"dead","at":"2026-07-01T23:00:00Z"}}'
  );
  assert.equal(readDaemonHealth(target).state, 'persistent-failure');
});

// BL-144: a daemon death now alarms and hard-stops instead of restarting -
// 'halted' is the terminal state the supervisor writes for that, and it
// must not be swallowed as 'unknown' the way a truly unrecognized state is.
test('readDaemonHealth reports halted with the incident reason', () => {
  const target = mkTarget(
    '{"state":"halted","last_incident":{"reason":"dead","at":"2026-07-01T23:00:00Z"},"failure_log":"/tmp/x.log"}'
  );
  const health = readDaemonHealth(target);
  assert.equal(health.state, 'halted');
  assert.equal(health.detail, 'dead');
});

test('readDaemonHealth is unknown (no alarm) when no status file exists', () => {
  const target = mkTarget(undefined);
  assert.equal(readDaemonHealth(target).state, 'unknown');
});

test('readDaemonHealth is unknown for malformed status content', () => {
  const target = mkTarget('not json at all');
  assert.equal(readDaemonHealth(target).state, 'unknown');
});

test('readDaemonHealth is unknown for a well-formed but unrecognized state value', () => {
  const target = mkTarget('{"state":"booting"}');
  assert.deepEqual(readDaemonHealth(target), { state: 'unknown' });
});

test('readDaemonHealth omits detail when a non-healthy state has no incident reason', () => {
  const target = mkTarget('{"state":"restarting"}');
  assert.deepEqual(readDaemonHealth(target), { state: 'restarting' });
});

test('computeDaemonProcessStatus reports skipped when daemon is disabled', () => {
  const target = mkTarget(undefined);
  const status = computeDaemonProcessStatus(target, { SWARMFORGE_SKIP_DAEMON: '1' });
  assert.equal(status.phase, 'skipped');
  assert.match(status.label, /SKIP_DAEMON/);
});

test('computeDaemonProcessStatus reports halted from the status file', () => {
  const target = mkTarget('{"state":"halted","last_incident":{"reason":"dead"}}');
  const status = computeDaemonProcessStatus(target);
  assert.equal(status.phase, 'halted');
  assert.match(status.label, /HALTED/);
  assert.equal(status.detail, 'dead');
});

test('computeDaemonProcessStatus reports dead when pid is missing', () => {
  const target = mkTarget('{"state":"healthy"}');
  const status = computeDaemonProcessStatus(target);
  assert.equal(status.phase, 'dead');
});

test('computeDaemonProcessStatus reports starting when pid is alive but heartbeat is absent', () => {
  const target = mkTarget('{"state":"unknown"}');
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.writeFileSync(path.join(daemonDir, 'handoffd.pid'), '4242');
  const status = computeDaemonProcessStatus(target, {}, 1_000_000, {
    isPidAlive: () => true,
    heartbeatAgeMs: null,
  });
  assert.equal(status.phase, 'starting');
});

test('computeDaemonProcessStatus reports polling on a fresh heartbeat', () => {
  const target = mkTarget('{"state":"healthy"}');
  fs.writeFileSync(path.join(target, '.swarmforge', 'daemon', 'handoffd.pid'), '4242');
  const status = computeDaemonProcessStatus(target, {}, 20_000, {
    isPidAlive: () => true,
    heartbeatAgeMs: 5_000,
  });
  assert.equal(status.phase, 'polling');
});

test('computeDaemonProcessStatus reports up between polling and stall thresholds', () => {
  const target = mkTarget('{"state":"healthy"}');
  fs.writeFileSync(path.join(target, '.swarmforge', 'daemon', 'handoffd.pid'), '4242');
  const status = computeDaemonProcessStatus(target, {}, 40_000, {
    isPidAlive: () => true,
    heartbeatAgeMs: 20_000,
  });
  assert.equal(status.phase, 'up');
});

test('computeDaemonProcessStatus reports stale when heartbeat exceeds stall budget', () => {
  const target = mkTarget('{"state":"healthy"}');
  fs.writeFileSync(path.join(target, '.swarmforge', 'daemon', 'handoffd.pid'), '4242');
  const status = computeDaemonProcessStatus(target, {}, 100_000, {
    isPidAlive: () => true,
    heartbeatAgeMs: 45_000,
  });
  assert.equal(status.phase, 'stale');
});

// --- webview side ---

test('webview HTML has a daemon-status marker with phase styling', () => {
  const html = getWebviewHtml('script.js', 'csp');
  assert(html.includes('id="daemon-status"'), 'must have the daemon-status element');
  assert(html.includes('.daemon-status.polling'), 'must style the polling phase');
  assert(html.includes('.daemon-status.dead'), 'must style the dead phase');
});

test('webview HTML has a transport-health marker with alarm styling', () => {
  const html = getWebviewHtml('script.js', 'csp');
  assert(html.includes('id="transport-health"'), 'must have the transport-health element');
  assert(html.includes('.transport-health.down'), 'must style the persistent-failure state');
});

// BL-121: delivery-level transport health is separate from daemon process status.
test('panel.js renders transport health states and clears the alarm when healthy', () => {
  const panelJs = loadPanelSource();
  assert(panelJs.includes("case 'transportHealth':"), 'must handle the transportHealth message');
  assert(/broken/.test(panelJs), 'must recognize the broken delivery state');
  assert(/delivery-degraded/.test(panelJs), 'must recognize the delivery-degraded state');
});

test('panel.js renders daemon process status updates from the host', () => {
  const panelJs = loadPanelSource();
  assert(panelJs.includes("case 'daemonProcessStatus':"), 'must handle daemonProcessStatus messages');
  assert(/daemon-status/.test(panelJs), 'must apply daemon-status classes');
});
