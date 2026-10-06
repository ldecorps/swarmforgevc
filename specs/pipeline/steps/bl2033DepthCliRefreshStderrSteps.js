'use strict';

// BL-2033: step handlers for "The depth CLI passes on a refresh failure the
// refresh reports on exit 0". Since BL-1874 the throttle refresh CLI
// (emit-throttle-recommendation.js) exits 0 when its refresh fails and names
// the failure on stderr; effective_backlog_depth_cli.bb's
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');

const FEATURE = 'BL-2033 The depth CLI passes on a refresh failure the refresh reports on exit 0';

// The ticket's Examples rows, validated against explicit known values:
// both rows carry the same failure message; the only difference is the
// refresh's exit (0 = the BL-1874 case, 1 = the pre-BL-1874 case).
const KNOWN_CARRIES = 'refresh failed: blocked telemetry';
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

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture project whose configured active_backlog_max_depth is 3 and whose throttle refresh CLI writes a failure message to stderr and exits 0$/,
    (ctx) => {
      ctx.targetRepo = trackedTmpRoot('bl2033-depth-refresh-');
      fs.mkdirSync(path.join(ctx.targetRepo, 'swarmforge'), { recursive: true });
      fs.writeFileSync(
        path.join(ctx.targetRepo, 'swarmforge', 'swarmforge.conf'),
        'config active_backlog_max_depth 3\n'
      );
      // The Background's own exit-0 case: the refresh names the failure on
      // stderr and exits 0 (BL-1874's contract).
      writeFakeRefreshCli(ctx.targetRepo, KNOWN_CARRIES, 0);
    }
  );

  // ── Given: the Examples row's refresh behavior ────────────────────────
  scoped(/^the refresh CLI exits with (\d+) and writes (.+) to stderr$/, (ctx, exit, carries) => {
    assert.ok(KNOWN_EXITS.has(exit), `expected the refresh exit to be one of the ticket's known values (0, 1), got: ${exit}`);
    assert.equal(carries, KNOWN_CARRIES, `expected the refresh message to be the ticket's known value, got: ${JSON.stringify(carries)}`);
    writeFakeRefreshCli(ctx.targetRepo, carries, exit);
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the depth CLI runs on the fixture root$/, (ctx) => runDepthCli(ctx));

  // ── Then: stdout is the effective depth and nothing else ──────────────
  // The fixture has no recommendation on disk and the fake refresh writes
  // none, so the effective depth is the configured 3 - and stdout must be
  // exactly that, whatever the refresh did (the ticket's invariant).
  scoped(/^the depth CLI's stdout is the effective depth and nothing else$/, (ctx) => {
    assert.equal(ctx.depthStdout, '3\n', `expected the depth CLI's stdout to be the effective depth (3) and nothing else, got: ${JSON.stringify(ctx.depthStdout)}`);
  });

  // ── And: stderr carries what the refresh reported ─────────────────────
  scoped(/^the depth CLI's stderr carries (.+)$/, (ctx, carries) => {
    assert.ok(ctx.depthStderr.includes(carries), `expected the depth CLI's stderr to carry ${JSON.stringify(carries)}, got: ${JSON.stringify(ctx.depthStderr)}`);
  });
}

module.exports = { registerSteps };
