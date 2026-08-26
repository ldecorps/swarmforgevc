'use strict';

// BL-948: step handlers for "acceptance fixtures that build a control
// socket use a short root". Drives the REAL shared modules - the helper
// (lib/socketFixtureRoot.js), the gate (lib/socketFixtureRootGuard.js), and
// the real role_lifecycle.sh unpark path for the previously-failing BL-368
// scenario shape - never a re-statement of any of them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const {
  mkSocketFixtureRoot,
  SOCKET_PATH_GUARD_LIMIT,
  WORST_CASE_SOCKET_SUFFIX,
} = require('./lib/socketFixtureRoot');
const {
  scanForSocketFixtureRootViolations,
} = require('./lib/socketFixtureRootGuard');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const FEATURE = 'Acceptance fixtures that build a control socket use a short root';

// Scenario Outline <fixture>/<verdict> values validated against explicit
// lookups (the Outline rule) - never a bare passthrough.
const FIXTURE_EXAMPLES = {
  'builds a control socket under an os.tmpdir() root': {
    body:
      // Assembled by concatenation so THIS file's own text never contains
      // the contiguous trap pattern the gate inspects for (the gate has no
      // hand-list to exempt this file with - by design, invariant 1).
      "const root = fs.mkdtempSync(path.join(os." + "tmpdir(), 'gen-'));\n" +
      "fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), 'x');\n",
    expectFlagged: true,
  },
  'creates a fixture root but builds no control socket': {
    body: "const root = fs.mkdtempSync(path.join(os." + "tmpdir(), 'gen-'));\n",
    expectFlagged: false,
  },
};

const VERDICT_EXAMPLES = {
  'fails naming': true,
  'stays silent about': false,
};

function knownFixture(token) {
  if (!Object.prototype.hasOwnProperty.call(FIXTURE_EXAMPLES, token)) {
    throw new Error(`unknown <fixture> token: ${token}`);
  }
  return FIXTURE_EXAMPLES[token];
}

function knownVerdict(token) {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_EXAMPLES, token)) {
    throw new Error(`unknown <verdict> token: ${token}`);
  }
  return VERDICT_EXAMPLES[token];
}

let trackedRoots = [];
let trackedProcs = [];

afterEach(() => {
  while (trackedProcs.length) {
    try {
      trackedProcs.pop().kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function track(root) {
  trackedRoots.push(root);
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^the shared fixture-root helper for socket-building fixtures$/, (ctx) => {
    ctx.mkRoot = mkSocketFixtureRoot;
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^a fixture root is created through it$/, (ctx) => {
    ctx.root = track(ctx.mkRoot('bl948-acc-'));
  });

  scoped(/^the control socket path built under it is within the guard's limit$/, (ctx) => {
    const socketPath = `${ctx.root}${WORST_CASE_SOCKET_SUFFIX}`;
    assert.ok(
      socketPath.length <= SOCKET_PATH_GUARD_LIMIT,
      `expected ${socketPath} (${socketPath.length} chars) within the ${SOCKET_PATH_GUARD_LIMIT}-char guard`
    );
  });

  // ── Scenario 02: the previously failing BL-368 shape, through the helper ──
  scoped(/^a role whose process is still alive$/, (ctx) => {
    ctx.role = 'coder';
    ctx.root = track(ctx.mkRoot('bl948-368-'));
    fs.mkdirSync(path.join(ctx.root, 'swarmforge', 'roles'), { recursive: true });
    fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'heartbeat'), { recursive: true });
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'constitution.prompt'), '');
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'roles', `${ctx.role}.prompt`), 'role prompt\n');
    fs.writeFileSync(path.join(ctx.root, 'swarmforge', 'swarmforge.conf'), `window ${ctx.role} claude ${ctx.role} --model x\n`);
    ctx.liveProcess = spawn('sleep', ['20'], { stdio: 'ignore' });
    trackedProcs.push(ctx.liveProcess);
    const heartbeat = `role: ${ctx.role}\npid: ${ctx.liveProcess.pid}\nlast_beat: "2026-07-14T00:00:00Z"\nlast_tool: Bash\nphase: entry\nin_flight: false\nbeat_count: 1\n`;
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'heartbeat', `${ctx.role}.yaml`), heartbeat);
  });

  scoped(/^the fixture relaunches that role through role_lifecycle\.sh unpark$/, (ctx) => {
    const fakeBin = track(ctx.mkRoot('bl948-fakebin-'));
    const claude = path.join(fakeBin, 'claude');
    fs.writeFileSync(claude, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(claude, 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    delete env.SWARMFORGE_CONFIG;
    ctx.result = spawnSync('bash', [path.join(SWARM_SCRIPTS, 'role_lifecycle.sh'), ctx.root, 'unpark', ctx.role], {
      env,
      encoding: 'utf8',
    });
  });

  scoped(/^it refuses because the process is still running$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected unpark to refuse, got: ${JSON.stringify(ctx.result)}`);
    assert.ok(
      (ctx.result.stderr || '').includes('still alive'),
      `expected the refusal to name the still-alive reason, got stderr: ${ctx.result.stderr}`
    );
  });

  scoped(/^the refusal does not mention the socket path limit$/, (ctx) => {
    const all = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
    assert.ok(
      !/socket path|sun_path|path limit|100 chars/i.test(all),
      `expected no socket-path-limit refusal, got: ${all}`
    );
  });

  // ── Scenario 03 (Outline): the gate's verdict by inspection ───────────────
  scoped(/^a step file that (.+)$/, (ctx, token) => {
    const { body, expectFlagged } = knownFixture(token);
    ctx.expectFlagged = expectFlagged;
    ctx.scanDir = track(ctx.mkRoot('bl948-gate-'));
    ctx.stepFile = path.join(ctx.scanDir, 'generatedSteps.js');
    fs.writeFileSync(ctx.stepFile, body);
  });

  scoped(/^the fixture-root gate runs$/, (ctx) => {
    ctx.violations = scanForSocketFixtureRootViolations(ctx.scanDir);
  });

  scoped(/^it (.+) that step file$/, (ctx, token) => {
    const expectFlagged = knownVerdict(token);
    assert.equal(
      expectFlagged,
      ctx.expectFlagged,
      'Examples-table self-check: verdict column must agree with the fixture column'
    );
    const flagged = ctx.violations.some((v) => v.file === ctx.stepFile);
    assert.equal(
      flagged,
      expectFlagged,
      `expected flagged=${expectFlagged} for ${ctx.stepFile}, got violations: ${JSON.stringify(ctx.violations)}`
    );
  });

  // ── Scenario 05: throw-safe removal ───────────────────────────────────────
  scoped(/^a scenario holding a fixture root throws before its last assertion$/, (ctx) => {
    // A REAL child process: it creates a root through the helper, then
    // throws - the death path the exit-hook backstop exists for.
    const helperPath = path.join(__dirname, 'lib', 'socketFixtureRoot.js');
    const script =
      `const { mkSocketFixtureRoot } = require(${JSON.stringify(helperPath)});\n` +
      `const root = mkSocketFixtureRoot('bl948-throw-');\n` +
      `console.log(root);\n` +
      `throw new Error('scenario failed before its cleanup');`;
    let stdout = '';
    try {
      stdout = execFileSync('node', ['-e', script], { encoding: 'utf8' });
    } catch (err) {
      stdout = err.stdout || '';
    }
    ctx.thrownRoot = stdout.trim().split('\n').pop();
    assert.ok(ctx.thrownRoot && ctx.thrownRoot.startsWith('/'), `child did not report its root: ${JSON.stringify(stdout)}`);
  });

  scoped(/^that fixture root is removed anyway$/, (ctx) => {
    assert.ok(!fs.existsSync(ctx.thrownRoot), `expected the thrown-scenario root to be removed, but ${ctx.thrownRoot} survives`);
  });
}

module.exports = { registerSteps };
