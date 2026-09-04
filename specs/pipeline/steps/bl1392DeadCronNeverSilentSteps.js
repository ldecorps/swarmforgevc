'use strict';

// BL-1392: a dead cron daemon is never silent.
//
// Drives the REAL installer (with a controlled `pgrep` shim), the REAL
// launcher, and the REAL heartbeat decision through this ticket's own e2e
// script. Both halves matter and neither substitutes for the other: the
// install-time probe is green at start and blind afterwards - the BL-1235
// shape - so the runtime heartbeat is the load-bearing half, and the e2e
// exercises both.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1392 A dead cron daemon is never silent';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1392_dead_cron_never_silent.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  marker: 'a dead cron daemon is named at install time (CRON_DAEMON_DOWN)',
  'names-fix': 'and the marker names the host command that fixes it',
  'non-zero': 'and the installer exits non-zero',
  'lines-written': 'the crontab lines are STILL installed, so they fire the moment cron starts',
  'live-quiet': 'a live cron daemon prints no marker',
  'live-zero': 'and the installer exits 0 exactly as before',
  'launch-shows': 'a swarm start with no cron daemon shows the marker in its own output',
  'stale-escalates': 'a freshness log aged past the bound escalates once',
  'second-quiet': 'a second tick in the same episode escalates nothing more',
  'fresh-clears': 'a refreshed log clears the episode (BL-920 self-healing)',
  're-arms': 'and aging it again is a NEW escalation',
  'sweep-label': 'the daemon carries the cron-heartbeat-stale sweep label',
  'sweep-registered': 'and registers it on the shared sweep cadence',
  'never-starts': 'nothing starts, restarts or configures a cron daemon (invariant 3)',
  'no-host-config': 'no host configuration file is written by the installer or the decision',
  'wsl-conf-untouched': 'and /etc/wsl.conf is untouched by these runs',
};

// Module scope, deliberately: the runtime gives each scenario its own ctx, so
// a per-ctx memo re-ran this whole suite once per scenario - 6-9 invocations
// per feature, several roles running acceptance at once. That multiplier is
// half of how 1156 concurrent copies of a sibling suite came to exist
// (BL-1390's second incident). One run per process, shared by every scenario.
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1392 = { ...(ctx.bl1392 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  if (ctx.bl1392?.out) return ctx.bl1392.out;
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1392 = { ...(ctx.bl1392 || {}), out, status: res.status };
  suiteRun = { out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1392 cron e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^no cron daemon is running on the host$/, (ctx) => {
    ctx.bl1392 = { ...(ctx.bl1392 || {}), cron: 'dead' };
  });

  scoped(/^a cron daemon is running on the host$/, (ctx) => {
    ctx.bl1392 = { ...(ctx.bl1392 || {}), cron: 'alive' };
  });

  scoped(/^the freshness cron log is older than the heartbeat bound$/, (ctx) => {
    ctx.bl1392 = { ...(ctx.bl1392 || {}), heartbeat: 'stale' };
  });

  scoped(/^the daemon sweep has already escalated once$/, (ctx) => {
    ctx.bl1392.heartbeat = 'escalated';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the swarm cron lines are installed$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the ancillary services are started$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the daemon sweep runs twice$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the freshness cron log is refreshed and the sweep runs$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the swarm cron lines are installed and the daemon sweep runs$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the output carries CRON_DAEMON_DOWN$/, (ctx) => {
    requirePassed(ctx, 'marker');
  });

  scoped(/^the output names the command that starts cron$/, (ctx) => {
    requirePassed(ctx, 'names-fix');
  });

  scoped(/^the install exits non-zero$/, (ctx) => {
    requirePassed(ctx, 'non-zero');
  });

  scoped(/^the cron lines are still written$/, (ctx) => {
    requirePassed(ctx, 'lines-written');
  });

  scoped(/^the output omits CRON_DAEMON_DOWN$/, (ctx) => {
    requirePassed(ctx, 'live-quiet');
  });

  scoped(/^the install exits zero$/, (ctx) => {
    requirePassed(ctx, 'live-zero');
  });

  scoped(/^the start output carries CRON_DAEMON_DOWN$/, (ctx) => {
    requirePassed(ctx, 'launch-shows');
  });

  scoped(/^the log carries cron-heartbeat-stale$/, (ctx) => {
    requirePassed(ctx, 'stale-escalates');
    // A label the daemon never registers is the BL-1235 shape, so both halves
    // of "the daemon carries it" are asserted here.
    requirePassed(ctx, 'sweep-label');
    requirePassed(ctx, 'sweep-registered');
  });

  scoped(/^exactly one escalation was sent$/, (ctx) => {
    requirePassed(ctx, 'second-quiet');
  });

  scoped(/^the episode is cleared$/, (ctx) => {
    requirePassed(ctx, 'fresh-clears');
  });

  scoped(/^a later stale log escalates again$/, (ctx) => {
    requirePassed(ctx, 're-arms');
  });

  scoped(/^no process attempted to start a cron daemon$/, (ctx) => {
    requirePassed(ctx, 'never-starts');
  });

  scoped(/^no host configuration file was written$/, (ctx) => {
    requirePassed(ctx, 'no-host-config');
    requirePassed(ctx, 'wsl-conf-untouched');
  });
}

module.exports = { registerSteps };
