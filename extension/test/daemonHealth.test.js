const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readDaemonHealth } = require('../out/swarm/daemonHealth');
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

// --- webview side ---

test('webview HTML has a transport-health marker with alarm styling', () => {
  const html = getWebviewHtml('script.js', 'csp');
  assert(html.includes('id="transport-health"'), 'must have the transport-health element');
  assert(html.includes('.transport-health.down'), 'must style the persistent-failure state');
});

test('panel.js renders transport health states and clears the alarm when healthy', () => {
  const panelJs = loadPanelSource();
  assert(panelJs.includes("case 'transportHealth':"), 'must handle the transportHealth message');
  assert(/persistent-failure/.test(panelJs), 'must recognize the persistent-failure state');
  assert(/restarting/.test(panelJs), 'must recognize the restarting state');
});
