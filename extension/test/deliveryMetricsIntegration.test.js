const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { computeDeliveryMetrics } = require('../out/metrics/deliveryMetrics');

// BL-096: computeDeliveryMetrics is the one impure entry point (shells to
// git, reads the backlog/ folder state) - exercised here end-to-end over a
// real git repo, mirroring swarmMetrics.test.js's own fixture convention.
// Every derivation it delegates to is independently unit-tested with fake
// history in deliveryMetrics.test.js; this file only proves the wiring.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-delivery-metrics-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
}

test('computeDeliveryMetrics wires git history + current backlog state into every metric (metrics-01/02/03/08/09)', () => {
  const repo = mkTmp();
  initRepo(repo);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(repo, 'backlog', 'active', 'BL-101.yaml'),
    'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\npriority: 1\n'
  );
  fs.writeFileSync(
    path.join(repo, 'backlog', 'active', 'BL-102.yaml'),
    'id: BL-102\ntitle: t\nstatus: active\nmilestone: M4\npriority: 2\n'
  );
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'spec BL-101/102'], '2026-06-01T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done', 'M4'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/M4/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-06-05T08:00:00');

  const nowMs = Date.parse('2026-06-10T00:00:00Z');
  const result = computeDeliveryMetrics(repo, [], nowMs);

  // velocity: one close recorded on 2026-06-05
  const closeCount = result.velocity.weeklySeries.reduce((sum, p) => sum + p.value, 0);
  assert.equal(closeCount, 1);

  // burndown: milestone M4 has 2 members, 1 closed -> currentRemaining 1
  const m4 = result.burndown.find((b) => b.milestone === 'M4');
  assert.ok(m4);
  assert.equal(m4.currentRemaining, 1);

  // cycle time: BL-101 took 4 days (06-01 -> 06-05)
  assert.equal(result.cycleTime.sampleCount, 1);
  assert.equal(result.cycleTime.medianMs, 4 * 24 * 60 * 60 * 1000);

  // forecasts: the one remaining open ticket (BL-102) carries a forecast
  assert.equal(result.forecasts.tickets.length, 1);
  assert.equal(result.forecasts.tickets[0].ticketId, 'BL-102');
  assert.ok(result.forecasts.tickets[0].p50Iso);

  // suite duration: no .test-durations.jsonl in this fixture repo
  assert.equal(result.suiteDurationTrend.hasLocalData, false);
});

test('computeDeliveryMetrics creates or modifies no files when run twice with no intervening git changes (metrics-05)', () => {
  const repo = mkTmp();
  initRepo(repo);
  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(repo, 'backlog', 'active', 'BL-101.yaml'),
    'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n'
  );
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'spec BL-101'], '2026-06-01T08:00:00');

  const before = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  computeDeliveryMetrics(repo, [], Date.parse('2026-06-10T00:00:00Z'));
  computeDeliveryMetrics(repo, [], Date.parse('2026-06-10T00:00:00Z'));
  const after = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });

  assert.equal(before, '');
  assert.equal(after, '');
});
