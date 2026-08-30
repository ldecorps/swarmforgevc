'use strict';

// BL-1225: step handlers for "a build-freshness sync's restart leaves a
// readable trail behind it".
//
// What is real here and what is not, stated plainly. The sync's two restart
// steps (restart-operator-group! / restart-handoffd-group!) are private to
// build_freshness_cli.bb and each kills live processes, deletes state files
// and waits for a real replacement to publish a fresh build_sha - a real
// sync is not something a scenario can run. So each scenario drives the
// PRODUCTION artefact the ticket actually changes:
//
//   scenario 01 spawns through build_freshness_lib.bb's own
//     operator-log-spawn-opts - the opts map restart-operator-group! passes
//     to babashka.process, never a copy of it. Truncation lived entirely in
//     that map;
//   scenarios 02/03 run the REAL start_handoff_daemon.sh, with the caller value
//     build_freshness_lib.bb's own daemon-start-caller publishes, and
//     with nothing set for the direct case. The audit line is the real
//     script's own output.
//
// The ticket is explicit that WHICH processes a sync restarts, and when, is
// not to change - so nothing here drives that, and nothing here asserts it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'build_freshness_lib.bb');
const START_DAEMON = path.join(SCRIPTS, 'start_handoff_daemon.sh');

const FEATURE = "BL-1225 a build-freshness sync's restart leaves a readable trail behind it";

// engineering.prompt's explicit-lookup rule: the caller label the feature
// quotes is checked against the one the production lib actually publishes,
// never accepted as a bare literal from the scenario text.
const KNOWN_CALLERS = { build_freshness_cli: true };

function knownCaller(label) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_CALLERS, label)) {
    throw new Error(`unknown caller label: ${label}`);
  }
  return label;
}

const PRIOR_LINE = 'operator_runtime tick at 2026-08-28T01:12:00Z';
const REPLACEMENT_LINE = 'operator_runtime starting build_sha=abc123';

function bb(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return result.stdout;
}

function syncCallerFromLib() {
  return bb(
    `(load-file ${JSON.stringify(LIB)}) (print build-freshness-lib/daemon-start-caller)`
  ).trim();
}

function startAuditLine(root) {
  const auditPath = path.join(root, '.swarmforge', 'daemon', 'daemon-start-audit.log');
  const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';
  const line = audit.split('\n').find((l) => l.includes('start_handoff_daemon invoked'));
  assert.ok(line, `no start-audit line was written: ${JSON.stringify(audit)}`);
  return line;
}

function runStartDaemon(ctx, extraEnv) {
  const stub = path.join(ctx.root, 'stub.bb');
  fs.writeFileSync(stub, '#!/usr/bin/env bb\n(System/exit 0)\n', { mode: 0o755 });
  const env = {
    ...process.env,
    HANDOFFD_BB: stub,
    HANDOFFD_SUPERVISOR_BB: stub,
    PID_WAIT_ATTEMPTS: '1',
  };
  delete env.SWARMFORGE_DAEMON_START_CALLER;
  Object.assign(env, extraEnv);
  spawnSync('bash', [START_DAEMON, ctx.root], { encoding: 'utf8', env, cwd: ctx.root });
}

function ensureRoot(ctx) {
  if (!ctx.root) {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1225-aps-'));
  }
  return ctx.root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^runtime\.log holds a line written by the running operator runtime$/, (ctx) => {
    const root = ensureRoot(ctx);
    ctx.logFile = path.join(root, 'runtime.log');
    fs.writeFileSync(ctx.logFile, `${PRIOR_LINE}\n`);
  });

  scoped(/^a build-freshness sync restarts the operator runtime$/, (ctx) => {
    const script = `
(require '[babashka.process :as process])
(load-file ${JSON.stringify(LIB)})
(let [opts (build-freshness-lib/operator-log-spawn-opts ${JSON.stringify(ctx.logFile)} ${JSON.stringify(ctx.root)})]
  @(process/process opts "bash" "-c" ${JSON.stringify(`printf '%s\\n' ${JSON.stringify(REPLACEMENT_LINE)}`)}))
`;
    bb(script);
    ctx.logAfter = fs.readFileSync(ctx.logFile, 'utf8');
  });

  scoped(/^runtime\.log still holds that earlier line$/, (ctx) => {
    assert.ok(
      ctx.logAfter.includes(PRIOR_LINE),
      `the restart discarded the previous runtime's log: ${JSON.stringify(ctx.logAfter)}`
    );
    assert.ok(
      ctx.logAfter.startsWith(`${PRIOR_LINE}\n`),
      'the earlier line survived but no longer comes first - this is an append, not a rewrite'
    );
  });

  scoped(/^runtime\.log also holds the replacement runtime's own startup line$/, (ctx) => {
    assert.ok(
      ctx.logAfter.includes(REPLACEMENT_LINE),
      `the replacement runtime's output is missing: ${JSON.stringify(ctx.logAfter)}`
    );
    cleanup(ctx);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^a build-freshness sync restarts the handoff daemon$/, (ctx) => {
    ensureRoot(ctx);
    runStartDaemon(ctx, { SWARMFORGE_DAEMON_START_CALLER: syncCallerFromLib() });
    ctx.auditLine = startAuditLine(ctx.root);
  });

  scoped(/^the daemon start audit line names caller "(.+)"$/, (ctx, label) => {
    const caller = knownCaller(label);
    assert.equal(
      caller,
      syncCallerFromLib(),
      'the feature names a caller the production lib does not publish'
    );
    assert.ok(
      ctx.auditLine.includes(`caller=${caller}`),
      `the audit line does not name the sync as caller: ${ctx.auditLine}`
    );
    cleanup(ctx);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────
  scoped(/^the handoff daemon is started directly rather than by a sync$/, (ctx) => {
    ensureRoot(ctx);
    runStartDaemon(ctx, {});
    ctx.auditLine = startAuditLine(ctx.root);
  });

  scoped(/^the daemon start audit line does not name caller "(.+)"$/, (ctx, label) => {
    const caller = knownCaller(label);
    assert.ok(
      !ctx.auditLine.includes(`caller=${caller}`),
      `a start no sync initiated was attributed to one: ${ctx.auditLine}`
    );
    // The label only means something if the unattributed case still says so.
    assert.ok(
      ctx.auditLine.includes('caller=unknown'),
      `an unattributed start lost its fallback: ${ctx.auditLine}`
    );
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
