'use strict';

// BL-2033: step handlers for "The effective depth CLI passes on a throttle
// refresh failure the refresh reports on exit 0". Since BL-1874 the throttle
// refresh CLI (emit-throttle-recommendation.js) exits 0 when its refresh
// fails and names the failure on stderr; effective_backlog_depth_cli.bb's
// refresh-recommendation! printed that stderr only on a non-zero exit, so
// the failure never reached the log of the role that asked for the depth.
//
// The fixture is built the way test_effective_backlog_depth_cli.sh's
// mk_fixture does: a trackedTmpRoot root holding swarmforge/swarmforge.conf
// with `config active_backlog_max_depth 3`, plus a FAKE
// extension/out/tools/emit-throttle-recommendation.js (a real file, not a
// symlink to this checkout's compiled one) that writes the Examples message
// to stderr and exits with the Examples exit. The REAL
// effective_backlog_depth_cli.bb is driven end to end via spawnSync, keeping
// stdout and stderr apart - never a re-implementation of the pass-on logic.
// trackedTmpRoot (BL-1636) reaps the root on every exit path, so no inline
// cleanup is needed.
//
// Row 3 (exit 0, empty message, stderr is empty) needs one thing the bare
// mk_fixture does not provide: a .swarmforge/swarm-identity whose
// active_backlog_max_depth_conf_path names the fixture conf, so the depth
// lib's "no swarm-identity ... falling back to the tracked default conf"
// notice does not reach stderr. Without it, row 3's literal "stderr is
// empty" cannot hold - the notice is the depth lib's own loud-on-stderr
// invariant (BL-966), not the refresh's output.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');

const FEATURE = 'BL-2033 The effective depth CLI passes on a throttle refresh failure the refresh reports on exit 0';

// The ticket's Examples rows, validated against explicit known values:
// row 1: exit 0, message "refresh failed: telemetry blocked" -> stderr names that message
// row 2: exit 1, message "refresh crashed" -> stderr names that message and exit=1
// row 3: exit 0, empty message -> stderr is empty
const KNOWN_MESSAGES = new Set([
  'refresh failed: telemetry blocked',
  'refresh crashed',
]);
const KNOWN_EXITS = new Set(['0', '1']);

function writeFakeRefreshCli(root, message, exit) {
  const toolsDir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  const cliPath = path.join(toolsDir, 'emit-throttle-recommendation.js');
  const body =
    `// fake throttle refresh CLI for the BL-2033 acceptance fixture\n` +
    `process.stderr.write(${JSON.stringify(message)} + '\\n');\n` +
    `process.exit(${Number(exit)});\n`;
  fs.writeFileSync(cliPath, body);
}

function writeSwarmIdentity(root) {
  // Row 3 needs the depth lib's conf-file-path to resolve without the
  // "no swarm-identity ... falling back to the tracked default conf"
  // notice reaching stderr. The swarm-identity file is tab-separated
  // key\tvalue lines (swarm_identity_lib/read-swarm-identity).
  const identityDir = path.join(root, '.swarmforge');
  fs.mkdirSync(identityDir, { recursive: true });
  const identityPath = path.join(identityDir, 'swarm-identity');
  fs.writeFileSync(
    identityPath,
    `swarm_name\tprimary\nactive_backlog_max_depth_conf_path\tswarmforge/swarmforge.conf\n`
  );
}

function runDepthCli(ctx) {
  const result = spawnSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`expected effective_backlog_depth_cli.bb to run, spawn failed: ${result.error.message}`);
  }
  ctx.depthStdout = result.stdout;
  ctx.depthStderr = result.stderr;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given: the fixture project ───────────────────────────────────────
  scoped(
    /^a project whose configured depth is 3 and whose throttle refresh exits (\d+) writing "(.*)" to stderr$/,
    (ctx, exit, message) => {
      assert.ok(KNOWN_EXITS.has(exit), `expected the refresh exit to be one of the ticket's known values (0, 1), got: ${exit}`);
      assert.ok(KNOWN_MESSAGES.has(message) || message === '', `expected the refresh message to be one of the ticket's known values, got: ${message}`);
      ctx.targetRepo = trackedTmpRoot('bl2033-depth-refresh-');
      fs.mkdirSync(path.join(ctx.targetRepo, 'swarmforge'), { recursive: true });
      fs.writeFileSync(
        path.join(ctx.targetRepo, 'swarmforge', 'swarmforge.conf'),
        'config active_backlog_max_depth 3\n'
      );
      writeSwarmIdentity(ctx.targetRepo);
      writeFakeRefreshCli(ctx.targetRepo, message, exit);
    }
  );

  // ── When: the effective depth CLI runs ───────────────────────────────
  scoped(/^the effective depth CLI runs$/, (ctx) => {
    runDepthCli(ctx);
  });

  // ── Then: stdout is the effective depth and nothing else ─────────────
  scoped(/^it prints 3 on stdout and nothing else$/, (ctx) => {
    assert.equal(ctx.depthStdout, '3\n', `expected stdout to be exactly "3\\n", got: ${JSON.stringify(ctx.depthStdout)}`);
  });

  // ── And: stderr carries the expected content ─────────────────────────
  scoped(/^its stderr (.+)$/, (ctx, carries) => {
    const stderr = ctx.depthStderr;
    if (carries === 'is empty') {
      assert.equal(stderr, '', `expected stderr to be empty, got: ${JSON.stringify(stderr)}`);
    } else if (carries === 'names that message and exit=1') {
      // The refresh's message plus exit=1, in the CLI's own stderr line.
      assert.ok(stderr.includes('exit=1'), `expected stderr to contain "exit=1", got: ${JSON.stringify(stderr)}`);
      assert.ok(stderr.includes('refresh crashed'), `expected stderr to contain the refresh message "refresh crashed", got: ${JSON.stringify(stderr)}`);
    } else if (carries === 'names that message') {
      // The refresh's message, in the CLI's own stderr line.
      assert.ok(stderr.includes('refresh failed: telemetry blocked'), `expected stderr to contain the refresh message "refresh failed: telemetry blocked", got: ${JSON.stringify(stderr)}`);
      assert.ok(!stderr.includes('exit='), `expected stderr to NOT contain "exit=" for an exit-0 refresh, got: ${JSON.stringify(stderr)}`);
    } else {
      throw new Error(`unknown carries value: ${carries}`);
    }
  });
}

module.exports = { registerSteps };
