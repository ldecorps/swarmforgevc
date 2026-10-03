'use strict';

// BL-671: operator_runtime fixtures share one sandbox-copy helper covering
// every lib operator_runtime.bb load-files.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO, 'swarmforge', 'scripts', 'test');
const HELPER = path.join(TEST_DIR, 'lib', 'operator_runtime_sandbox.sh');
const SCRIPTS = path.join(REPO, 'swarmforge', 'scripts');
const RUNTIME = path.join(SCRIPTS, 'operator_runtime.bb');

// test_operator_runtime_*.sh files that never sandbox operator_runtime.bb, so
// "every fixture that sandboxes it" does not include them. Each needs a
// reason. Any OTHER file that skips the shared helper still fails, which
// keeps BL-671's guard against a hand-listed copy coming back.
const NOT_A_RUNTIME_SANDBOX = {
  // BL-1224: drives the real operator_runtime_supervisor.bb with a stand-in
  // `bb ... operator_runtime.bb` process; it copies no runtime at all.
  'test_operator_runtime_watch_adoption.sh': 'drives the supervisor with a stand-in runtime (BL-1224)',
};

const FEATURE = 'every operator_runtime.bb test fixture sandboxes the libs it load-files';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function listFixtures() {
  return fs
    .readdirSync(TEST_DIR)
    .filter((f) => /^test_operator_runtime_.*\.sh$/.test(f))
    .filter((f) => !Object.prototype.hasOwnProperty.call(NOT_A_RUNTIME_SANDBOX, f))
    .sort();
}

function registerSteps(registry) {
  scoped(registry, /^"([^"]+)" builds a sandbox copy of operator_runtime\.bb$/, (ctx, fixture) => {
    if (fixture === 'the other nine test_operator_runtime_*.sh fixtures') {
      ctx.fixtures = listFixtures().filter((f) => f !== 'test_operator_runtime_bl647_rotation_liveness.sh');
    } else {
      ctx.fixtures = [fixture];
    }
    for (const f of ctx.fixtures) {
      const body = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
      if (!body.includes('operator_runtime_sandbox.sh') && !body.includes('copy_operator_runtime_sandbox')) {
        throw new Error(`${f} does not use the shared sandbox helper`);
      }
    }
  });

  scoped(registry, /^"([^"]+)" runs$/, (ctx, fixture) => {
    const toRun =
      fixture === 'the other nine test_operator_runtime_*.sh fixtures'
        ? ctx.fixtures
        : [fixture];
    ctx.results = {};
    for (const f of toRun) {
      const r = spawnSync('bash', [path.join(TEST_DIR, f)], {
        cwd: REPO,
        encoding: 'utf8',
        env: process.env,
        timeout: 120000,
      });
      ctx.results[f] = r;
    }
  });

  scoped(registry, /^it passes end-to-end$/, (ctx) => {
    for (const [f, r] of Object.entries(ctx.results)) {
      if (r.status !== 0) {
        throw new Error(`${f} failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
      }
    }
  });

  scoped(registry, /^operator_runtime\.bb loads successfully in its sandbox$/, (ctx) => {
    for (const [f, r] of Object.entries(ctx.results)) {
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      if (/FileNotFoundException|llm_cost_ledger_lib\.bb \(No such file/.test(out)) {
        throw new Error(`${f} failed to load operator_runtime in sandbox: ${out}`);
      }
    }
  });

  scoped(
    registry,
    /^operator_runtime\.bb load-files a new lib not yet in any fixture's sandbox copy list$/,
    (ctx) => {
      const runtime = fs.readFileSync(RUNTIME, 'utf8');
      const loadFiles = [...runtime.matchAll(/load-file[^\n]*"([^"]+\.bb)"/g)].map((m) => path.basename(m[1]));
      ctx.loadFiles = loadFiles;
      if (!fs.existsSync(HELPER)) throw new Error('missing shared helper');
      ctx.helper = fs.readFileSync(HELPER, 'utf8');
    }
  );

  scoped(registry, /^the fixtures' shared sandbox-copy helper is updated for the new lib$/, (ctx) => {
    // Contract check: helper is the single place; fixtures source it. Since
    // BL-973 the helper DERIVES the copy set (copy_bb_closure over its entry
    // points) instead of naming each lib, so "covers every load-file target"
    // means operator_runtime.bb is an entry point and its derived closure
    // holds every lib it load-files.
    if (!ctx.helper.includes('OPERATOR_RUNTIME_SANDBOX') && !ctx.helper.includes('copy_operator_runtime_sandbox')) {
      throw new Error('helper missing copy_operator_runtime_sandbox');
    }
    if (!ctx.helper.includes('copy_bb_closure') || !/^\s+operator_runtime\.bb\s*$/m.test(ctx.helper)) {
      throw new Error('helper does not derive its copy set from operator_runtime.bb (copy_bb_closure entry point)');
    }
    // The closure the helper copies is bb_load_closure_cli.bb's answer, so ask
    // that CLI, not the JS twin (BL-897 holds the two to the same answer).
    const r = spawnSync('bb', [path.join(SCRIPTS, 'bb_load_closure_cli.bb'), SCRIPTS, 'operator_runtime.bb'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`bb_load_closure_cli.bb failed: ${r.stderr}`);
    const closure = new Set(r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.basename(l)));
    for (const lib of ctx.loadFiles) {
      if (!closure.has(lib)) {
        throw new Error(`shared helper omits load-file target ${lib}`);
      }
    }
  });

  scoped(
    registry,
    /^every test_operator_runtime_\*\.sh fixture picks up the new lib without a per-fixture edit$/,
    () => {
      for (const f of listFixtures()) {
        const body = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
        if (!body.includes('copy_operator_runtime_sandbox')) {
          throw new Error(`${f} still has a per-fixture copy list instead of the shared helper`);
        }
      }
    }
  );
}

module.exports = { registerSteps };
