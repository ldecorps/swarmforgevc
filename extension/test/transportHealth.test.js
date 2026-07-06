/**
 * BL-121: delivery-level transport health detection — unit tests.
 *
 * "healthy" must mean parcels are actually being delivered, not merely that
 * the daemon process is alive. Tested entirely through fakes (temp dirs,
 * injected daemon-health/canary values) — no live babashka daemon or tmux.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isCanaryTask,
  evaluateCanary,
  readCanaryStatus,
  scanStalledParcels,
  deadLettersToOffending,
  computeTransportHealth,
  computeLiveTransportHealth,
} = require('../out/swarm/transportHealth');

const NOW = new Date('2026-07-05T22:00:00Z').getTime();

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-transport-health-'));
}

function writeHandoff(dir, name, headers, mtimeMs) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  const header = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(filePath, `${header}\n\nbody`, 'utf-8');
  fs.utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
  return filePath;
}

// ── isCanaryTask ──────────────────────────────────────────────────────────

test('isCanaryTask recognizes the canary task-name prefix', () => {
  assert.equal(isCanaryTask('canary-20260705T220000Z'), true);
  assert.equal(isCanaryTask('task-1-cave-setup'), false);
  assert.equal(isCanaryTask(undefined), false);
});

// ── evaluateCanary ────────────────────────────────────────────────────────

test('evaluateCanary reports no-data when no round trip has ever been recorded', () => {
  assert.deepEqual(evaluateCanary(null, NOW, 300), { state: 'no-data', ageSeconds: 0 });
});

test('evaluateCanary reports healthy for a round trip within budget', () => {
  const result = evaluateCanary(NOW - 60_000, NOW, 300);
  assert.equal(result.state, 'healthy');
  assert.equal(result.ageSeconds, 60);
});

test('evaluateCanary reports missed once the round trip exceeds its budget', () => {
  const result = evaluateCanary(NOW - 600_000, NOW, 300);
  assert.equal(result.state, 'missed');
  assert.equal(result.ageSeconds, 600);
});

test('evaluateCanary treats a round trip exactly at the budget boundary as healthy (inclusive <=)', () => {
  const result = evaluateCanary(NOW - 300_000, NOW, 300);
  assert.equal(result.state, 'healthy');
  assert.equal(result.ageSeconds, 300);
});

test('evaluateCanary treats one second past the budget boundary as missed', () => {
  const result = evaluateCanary(NOW - 301_000, NOW, 300);
  assert.equal(result.state, 'missed');
});

// ── scanStalledParcels ──────────────────────────────────────────────────────

test('scanStalledParcels ignores an item younger than the stall threshold', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeHandoff(inboxNewDir, '00_x_from_specifier_to_coder.handoff', { from: 'specifier', recipient: 'coder' }, NOW - 10_000);
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'inbox', 'in_process') }];
  assert.deepEqual(scanStalledParcels(roleInboxes, NOW, 300), []);
});

test('scanStalledParcels reports an item older than the stall threshold with its route and age', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeHandoff(inboxNewDir, '00_x_from_specifier_to_coder.handoff', { from: 'specifier', recipient: 'coder' }, NOW - 600_000);
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'inbox', 'in_process') }];
  const offending = scanStalledParcels(roleInboxes, NOW, 300);
  assert.equal(offending.length, 1);
  assert.equal(offending[0].route, 'specifier->coder');
  assert.equal(offending[0].reason, 'stalled');
  assert.equal(offending[0].ageSeconds, 600);
});

test('scanStalledParcels treats an item exactly at the stall threshold as stalled (exclusive < boundary)', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeHandoff(inboxNewDir, '00_x_from_specifier_to_coder.handoff', { from: 'specifier', recipient: 'coder' }, NOW - 300_000);
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'inbox', 'in_process') }];
  const offending = scanStalledParcels(roleInboxes, NOW, 300);
  assert.equal(offending.length, 1);
  assert.equal(offending[0].ageSeconds, 300);
});

test('scanStalledParcels falls back to "unknown" in the route when from/recipient headers are missing', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeHandoff(inboxNewDir, '00_x_no_headers.handoff', {}, NOW - 600_000);
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'inbox', 'in_process') }];
  const offending = scanStalledParcels(roleInboxes, NOW, 300);
  assert.equal(offending.length, 1);
  assert.equal(offending[0].route, 'unknown->unknown');
});

test('scanStalledParcels combines results across inbox/new and inbox/in_process for the same role', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const inProcessDir = path.join(target, 'inbox', 'in_process');
  writeHandoff(inboxNewDir, '00_x_from_a_to_b.handoff', { from: 'a', recipient: 'b' }, NOW - 600_000);
  writeHandoff(inProcessDir, '00_y_from_c_to_d.handoff', { from: 'c', recipient: 'd' }, NOW - 700_000);
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir }];
  const offending = scanStalledParcels(roleInboxes, NOW, 300);
  assert.equal(offending.length, 2);
  const routes = offending.map((o) => o.route).sort();
  assert.deepEqual(routes, ['a->b', 'c->d']);
});

test('scanStalledParcels also inspects in_process (a stuck-in-process parcel is still undelivered work)', () => {
  const target = mkTmp();
  const inProcessDir = path.join(target, 'inbox', 'in_process');
  writeHandoff(inProcessDir, '00_x_from_architect_to_hardener.handoff', { from: 'architect', recipient: 'hardener' }, NOW - 900_000);
  const roleInboxes = [{ role: 'hardener', inboxNewDir: path.join(target, 'inbox', 'new'), inProcessDir }];
  const offending = scanStalledParcels(roleInboxes, NOW, 300);
  assert.equal(offending.length, 1);
  assert.equal(offending[0].route, 'architect->hardener');
});

test('scanStalledParcels excludes canary-marked parcels from real-work accounting', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  writeHandoff(
    inboxNewDir,
    '00_x_from_coordinator_to_coordinator.handoff',
    { from: 'coordinator', recipient: 'coordinator', task: 'canary-20260705T210000Z' },
    NOW - 600_000
  );
  const roleInboxes = [{ role: 'coordinator', inboxNewDir, inProcessDir: path.join(target, 'inbox', 'in_process') }];
  assert.deepEqual(scanStalledParcels(roleInboxes, NOW, 300), []);
});

// ── deadLettersToOffending ────────────────────────────────────────────────

test('deadLettersToOffending converts a dead-lettered parcel into an offending entry with route and age', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeHandoff(
    inboxNewDir,
    '00_x_from_specifier_to_coder.handoff.dead',
    { from: 'specifier', recipient: 'coder' },
    NOW - 3600_000
  );
  const offending = deadLettersToOffending(
    [{ role: 'coder', filePath, from: 'specifier', recipient: 'coder', chaseCount: 3 }],
    NOW
  );
  assert.equal(offending.length, 1);
  assert.equal(offending[0].route, 'specifier->coder');
  assert.equal(offending[0].reason, 'dead-letter');
  assert.equal(offending[0].ageSeconds, 3600);
});

test('deadLettersToOffending falls back to "unknown" in the route when from/recipient are absent', () => {
  const target = mkTmp();
  const inboxNewDir = path.join(target, 'inbox', 'new');
  const filePath = writeHandoff(inboxNewDir, '00_x_no_headers.handoff.dead', {}, NOW - 3600_000);
  const offending = deadLettersToOffending(
    [{ role: 'coder', filePath, from: undefined, recipient: undefined, chaseCount: 1 }],
    NOW
  );
  assert.equal(offending[0].route, 'unknown->unknown');
});

// ── computeTransportHealth (the state machine) ───────────────────────────

test('delivery-detection-01 + stall-detection-02: dead-letters and stalled parcels both surface together, in order, with no canary miss', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [{ route: 'specifier->coder', ageSeconds: 300, reason: 'dead-letter' }],
    stalledParcels: [{ route: 'architect->hardener', ageSeconds: 900, reason: 'stalled' }],
    canary: { state: 'no-data', ageSeconds: 0 },
  });
  assert.equal(health.state, 'delivery-degraded');
  assert.deepEqual(health.offending, [
    { route: 'specifier->coder', ageSeconds: 300, reason: 'dead-letter' },
    { route: 'architect->hardener', ageSeconds: 900, reason: 'stalled' },
  ]);
});

test('delivery-detection-01: a dead-lettered parcel is reported even while the daemon heartbeats healthy', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [{ route: 'specifier->coder', ageSeconds: 300, reason: 'dead-letter' }],
    stalledParcels: [],
    canary: { state: 'no-data', ageSeconds: 0 },
  });
  assert.equal(health.state, 'delivery-degraded');
  assert.deepEqual(health.offending, [{ route: 'specifier->coder', ageSeconds: 300, reason: 'dead-letter' }]);
});

test('stall-detection-02: a parcel stuck past its age threshold is reported with age and route', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [],
    stalledParcels: [{ route: 'architect->hardener', ageSeconds: 900, reason: 'stalled' }],
    canary: { state: 'no-data', ageSeconds: 0 },
  });
  assert.equal(health.state, 'delivery-degraded');
  assert.deepEqual(health.offending, [{ route: 'architect->hardener', ageSeconds: 900, reason: 'stalled' }]);
});

test('canary-03: a successful canary round trip marks transport healthy with no offending parcels', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [],
    stalledParcels: [],
    canary: { state: 'healthy', ageSeconds: 30 },
  });
  assert.deepEqual(health, { state: 'healthy', offending: [] });
});

test('canary-03: a missed canary overrides mere process-liveness and marks transport broken', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [],
    stalledParcels: [],
    canary: { state: 'missed', ageSeconds: 900 },
  });
  assert.equal(health.state, 'broken');
  assert.deepEqual(health.offending, [{ route: 'canary', ageSeconds: 900, reason: 'canary-miss' }]);
});

test('a missed canary reports broken even when other offending parcels are also present', () => {
  const health = computeTransportHealth({
    daemonHealth: { state: 'healthy' },
    deadLetters: [{ route: 'specifier->coder', ageSeconds: 100, reason: 'dead-letter' }],
    stalledParcels: [],
    canary: { state: 'missed', ageSeconds: 900 },
  });
  assert.equal(health.state, 'broken');
  assert.equal(health.offending.length, 2);
});

test('with no offending parcels and no canary data, transport health falls back to daemon process health', () => {
  assert.deepEqual(
    computeTransportHealth({
      daemonHealth: { state: 'healthy' },
      deadLetters: [],
      stalledParcels: [],
      canary: { state: 'no-data', ageSeconds: 0 },
    }),
    { state: 'healthy', offending: [] }
  );
  assert.deepEqual(
    computeTransportHealth({
      daemonHealth: { state: 'persistent-failure' },
      deadLetters: [],
      stalledParcels: [],
      canary: { state: 'no-data', ageSeconds: 0 },
    }),
    { state: 'broken', offending: [] }
  );
  assert.deepEqual(
    computeTransportHealth({
      daemonHealth: { state: 'restarting' },
      deadLetters: [],
      stalledParcels: [],
      canary: { state: 'no-data', ageSeconds: 0 },
    }),
    { state: 'delivery-degraded', offending: [] }
  );
  assert.deepEqual(
    computeTransportHealth({
      daemonHealth: { state: 'unknown' },
      deadLetters: [],
      stalledParcels: [],
      canary: { state: 'no-data', ageSeconds: 0 },
    }),
    { state: 'unknown', offending: [] }
  );
});

// ── readCanaryStatus (file-backed, mirrors readDaemonHealth's pattern) ────

test('readCanaryStatus reports no-data when no canary status file exists yet', () => {
  const target = mkTmp();
  assert.deepEqual(readCanaryStatus(target, NOW, 300), { state: 'no-data', ageSeconds: 0 });
});

test('readCanaryStatus reads a recorded round trip and evaluates it against the budget', () => {
  const target = mkTmp();
  const dir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'canary-status.json'), JSON.stringify({ lastRoundTripMs: NOW - 60_000 }));
  assert.deepEqual(readCanaryStatus(target, NOW, 300), { state: 'healthy', ageSeconds: 60 });
});

test('readCanaryStatus is no-data (not a crash) for malformed status content', () => {
  const target = mkTmp();
  const dir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'canary-status.json'), 'not json');
  assert.deepEqual(readCanaryStatus(target, NOW, 300), { state: 'no-data', ageSeconds: 0 });
});

// ── computeLiveTransportHealth (end-to-end composition over real fs state) ─

test('computeLiveTransportHealth combines daemon health, dead-letters, and stalled scans from real directories', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'handoffd.status.json'), '{"state":"healthy"}');

  const inboxNewDir = path.join(target, 'coder', 'inbox', 'new');
  writeHandoff(
    inboxNewDir,
    '00_x_from_specifier_to_coder.handoff.dead',
    { from: 'specifier', recipient: 'coder' },
    NOW - 3600_000
  );
  const roleInboxes = [{ role: 'coder', inboxNewDir, inProcessDir: path.join(target, 'coder', 'inbox', 'in_process') }];

  const health = computeLiveTransportHealth(target, roleInboxes, NOW, {
    stallThresholdSeconds: 300,
    canaryBudgetSeconds: 300,
  });
  assert.equal(health.state, 'delivery-degraded');
  assert.equal(health.offending.length, 1);
  assert.equal(health.offending[0].route, 'specifier->coder');
});

test('computeLiveTransportHealth reports healthy when nothing is dead-lettered or stalled and the daemon is healthy', () => {
  const target = mkTmp();
  const daemonDir = path.join(target, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'handoffd.status.json'), '{"state":"healthy"}');
  const roleInboxes = [
    { role: 'coder', inboxNewDir: path.join(target, 'coder', 'inbox', 'new'), inProcessDir: path.join(target, 'coder', 'inbox', 'in_process') },
  ];
  const health = computeLiveTransportHealth(target, roleInboxes, NOW, {
    stallThresholdSeconds: 300,
    canaryBudgetSeconds: 300,
  });
  assert.deepEqual(health, { state: 'healthy', offending: [] });
});
