'use strict';

// BL-813: the handoffd death alarm named an on-disk failure-log path an
// off-box operator could not open, and ambulance_lib.bb's ticket-has-file?
// threw FileNotFoundException when a globbed backlog yaml vanished (moved
// active/ -> done/) before slurp - the exact incident that crashed the
// daemon on BL-812's own close.
//
// Drives the REAL suites/harnesses - never a parallel reimplementation:
//   - test_daemon_alarm_lib.sh (scenario 1: the attachment itself, already
//     extended with the "BL-813 attach-01" assertion)
//   - bl813_daemon_alarm_lib_property_runner.bb (scenario 1's "a failure
//     while building the attachment does not prevent halt-swarm!" clause -
//     property P2)
//   - bl813_acceptance_harness.bb (scenarios 2 and 3: the ambulance-side
//     vanish race and the vanished-ticket deadlock guard, both against the
//     real ambulance_lib.bb)

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DAEMON_ALARM_SUITE = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_daemon_alarm_lib.sh');
const PROPERTY_RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'bl813_daemon_alarm_lib_property_runner.bb');
const ACCEPTANCE_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'bl813_acceptance_harness.bb');

const FEATURE = 'BL-813 handoffd death alarm attaches its failure log';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runDaemonAlarmSuite(ctx) {
  if (!ctx.bl813Suite) {
    const result = spawnSync('bash', [DAEMON_ALARM_SUITE], { encoding: 'utf8', timeout: 180000, cwd: REPO_ROOT });
    ctx.bl813Suite = { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
  }
  return ctx.bl813Suite;
}

function runPropertyRunner(ctx) {
  if (!ctx.bl813Props) {
    const result = spawnSync('bb', [PROPERTY_RUNNER], {
      encoding: 'utf8',
      timeout: 60000,
      cwd: REPO_ROOT,
      env: { ...process.env, PROPERTY_RUNS: '150' },
    });
    ctx.bl813Props = { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
  }
  return ctx.bl813Props;
}

function runHarness(mode, fixtureRoot, ticketId) {
  const result = spawnSync('bb', [ACCEPTANCE_HARNESS, mode, fixtureRoot, ticketId], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: REPO_ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`bl813_acceptance_harness.bb ${mode} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  scoped(registry, /^BL-144 still alarms and halts the swarm on daemon death with no auto-restart$/, (ctx) => {
    ctx.bl813 = ctx.bl813 || {};
    ctx.bl813.bl144Assumed = true;
  });

  scoped(registry, /^daemon_alarm_lib already supports Resend attachments for briefing diagrams \(BL-286\)$/, (ctx) => {
    const src = fs.readFileSync(path.join(SWARMFORGE_SCRIPTS, 'daemon_alarm_lib.bb'), 'utf8');
    if (!/BL-286/.test(src) || !/attachments/.test(src)) {
      throw new Error('expected daemon_alarm_lib.bb to already carry BL-286 attachment support');
    }
  });

  // ── Scenario 1: death alarm email includes the failure log as an attachment ─
  scoped(registry, /^alarm-and-halt! has written handoffd-failure-<stamp>\.log$/, (ctx) => {
    const { status, out } = runDaemonAlarmSuite(ctx);
    if (!/PASS: 01: failure log contains death timestamp/.test(out)) {
      throw new Error(`expected the failure-log write to be proven, suite status ${status}:\n${out}`);
    }
  });

  scoped(registry, /^the configured alarm email is sent$/, (ctx) => {
    const { out } = runDaemonAlarmSuite(ctx);
    if (!/PASS: 02: exactly one alarm email sent/.test(out)) {
      throw new Error(`expected exactly one alarm email sent:\n${out}`);
    }
  });

  scoped(registry, /^the email body still names the failure-log path and \.\/swarm ensure$/, (ctx) => {
    const { out } = runDaemonAlarmSuite(ctx);
    if (!/PASS: 02: exactly one alarm email sent, naming the failure log path and recovery command/.test(out)) {
      throw new Error(`expected the email body to name the failure-log path and ./swarm ensure:\n${out}`);
    }
  });

  scoped(registry, /^the email carries one attachment whose filename is that failure log$/, (ctx) => {
    const { out } = runDaemonAlarmSuite(ctx);
    if (!/PASS: BL-813 attach-01: the death alarm email carries exactly one attachment whose bytes match the written failure log/.test(out)) {
      throw new Error(`expected exactly one attachment named for the failure log:\n${out}`);
    }
  });

  scoped(registry, /^the attachment bytes match the written failure-log content$/, (ctx) => {
    const { out } = runDaemonAlarmSuite(ctx);
    if (!/PASS: BL-813 attach-01/.test(out)) {
      throw new Error(`expected the attachment bytes to match the written failure-log content:\n${out}`);
    }
  });

  scoped(registry, /^a failure while building the attachment does not prevent halt-swarm!$/, (ctx) => {
    const { status, out } = runPropertyRunner(ctx);
    if (status !== 0 || !/ALL PROPERTIES HOLD/.test(out)) {
      throw new Error(`expected the attachment-build-failure-never-blocks-halt property to hold:\n${out}`);
    }
  });

  // ── Scenario 2: ticket-has-file? does not throw when a globbed yaml vanishes mid-read ─
  scoped(
    registry,
    /^fs\/glob listed backlog\/active\/BL-812-handoffd-cwd-breaks-mono-router-wake-remap\.yaml$/,
    (ctx) => {
      ctx.bl813 = ctx.bl813 || {};
      ctx.bl813.vanishRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl813-vanish-'));
      ctx.bl813.vanishTicket = 'BL-812';
    }
  );

  scoped(registry, /^that file is moved to backlog\/done\/ before slurp$/, (ctx) => {
    const { vanishRoot, vanishTicket } = ctx.bl813 || {};
    if (!vanishRoot) throw new Error('vanish-race fixture root missing — run the glob-listed step first');
    ctx.bl813.vanishResult = runHarness('ticket-has-file-vanish-race', vanishRoot, vanishTicket);
  });

  scoped(registry, /^ticket-has-file\? runs for that ticket id$/, (ctx) => {
    const { vanishResult } = ctx.bl813 || {};
    if (!vanishResult) throw new Error('vanish-race harness result missing');
  });

  scoped(registry, /^it returns false or finds the done\/ copy without throwing$/, (ctx) => {
    const { vanishResult } = ctx.bl813 || {};
    if (vanishResult.threw) {
      throw new Error(`ticket-has-file? threw instead of degrading: ${vanishResult.result}`);
    }
    if (vanishResult.result !== false && vanishResult.result !== true) {
      throw new Error(`unexpected ticket-has-file? result: ${JSON.stringify(vanishResult)}`);
    }
  });

  scoped(registry, /^handoffd poll-once! continues$/, (ctx) => {
    const { vanishResult } = ctx.bl813 || {};
    if (vanishResult.pollContinuesThrew) {
      throw new Error('read-ambulance-state (the site poll-once! calls) threw after the vanish race');
    }
  });

  // ── Scenario 3: vanished-only ticket still degrades ambulance to off ────
  scoped(registry, /^an ambulance marker names BL-999$/, (ctx) => {
    ctx.bl813 = ctx.bl813 || {};
    ctx.bl813.vanishedTicketRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl813-nofile-'));
  });

  scoped(registry, /^no yaml under backlog\/ declares id BL-999$/, (ctx) => {
    const { vanishedTicketRoot } = ctx.bl813 || {};
    if (!vanishedTicketRoot) throw new Error('vanished-ticket fixture root missing');
    // No backlog/ directory is created at all — deliberately no yaml anywhere.
  });

  scoped(registry, /^read-ambulance-state is called$/, (ctx) => {
    const { vanishedTicketRoot } = ctx.bl813 || {};
    ctx.bl813.vanishedResult = runHarness('vanished-ticket-degrade', vanishedTicketRoot, 'BL-999');
  });

  scoped(registry, /^active is false$/, (ctx) => {
    const { vanishedResult } = ctx.bl813 || {};
    if (vanishedResult.threw) throw new Error('read-ambulance-state threw for a vanished-only ticket');
    if (vanishedResult.active !== false) {
      throw new Error(`expected active=false, got ${JSON.stringify(vanishedResult)}`);
    }
  });

  scoped(registry, /^the swarm is not crashed by the probe$/, (ctx) => {
    const { vanishedResult } = ctx.bl813 || {};
    if (vanishedResult.threw) throw new Error('the probe crashed instead of degrading');
  });
}

module.exports = { registerSteps };
