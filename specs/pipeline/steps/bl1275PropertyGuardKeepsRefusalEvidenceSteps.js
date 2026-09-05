'use strict';

// BL-1275: step handlers for "a refused commit leaves the suite output
// behind". Drives the REAL swarmforge/scripts/check_property_suite_drift.sh
// through its documented positional suite-command seam - never an env
// bypass - in a scratch repository, the same shape BL-570's handlers use.
//
// Every assertion reads the guard's own output and the retained files it
// names; nothing here reimplements the retention rule it is checking.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1275 a refused commit leaves the suite output behind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const RETAIN_REL = path.join('.swarmforge', 'property-guard-refusals');

// The bound is lowered for scenario 04 only, so "more times than the
// retention bound allows" is five runs rather than twenty-one. It changes
// how many logs are kept, never whether a commit is refused.
const SCENARIO_KEEP = 3;

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// A repository whose only staged change is a suite-triggering path, so the
// guard reaches its suite run instead of short-circuiting on skip-paths.
function mkFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1275-acceptance-'));
  fixtureRoots.push(root);
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  git(root, 'add', '.gitignore');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null',
    'commit', '-q', '--no-verify', '-m', 'init');
  fs.mkdirSync(path.join(root, 'extension', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'src', 'board.ts'), 'v1\n');
  git(root, 'add', 'extension/src/board.ts');
  return root;
}

// An injected suite that prints the given body and exits with the given
// status - the script's own `[suite-command [args...]]` seam.
function suiteArgv(body, code) {
  return ['bash', '-c', 'printf "%s\\n" "$0"; exit ' + code, body];
}

function runGuard(ctx, body, code) {
  const env = { ...process.env };
  delete env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
  if (ctx.keep !== undefined) {
    env.SWARMFORGE_PROPERTY_GUARD_REFUSAL_KEEP = String(ctx.keep);
  }
  const result = spawnSync('bash', [GUARD, ...suiteArgv(body, code)], {
    cwd: ctx.root,
    encoding: 'utf8',
    env,
  });
  ctx.out = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.rc = result.status ?? 1;
  ctx.runs.push({ body, out: ctx.out, rc: ctx.rc });
}

function retainedLogs(ctx) {
  const dir = path.join(ctx.root, RETAIN_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^refusal-\d+-.*\.log$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

function namedPath(out) {
  const match = /retained at (\S+)/.exec(out);
  return match ? match[1] : '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property-suite guard is driven with an injected suite command$/, (ctx) => {
    assert.ok(fs.existsSync(GUARD), `expected the guard script at ${GUARD}`);
    ctx.root = mkFixtureRepo();
    ctx.runs = [];
    ctx.bodies = [];
  });

  scoped(/^the injected suite fails in a file that is not allowlisted$/, (ctx) => {
    // A file no allowlist row can match, so the red is a genuine refusal
    // rather than BL-1175's allowlisted-standing-reds exit 0.
    ctx.bodies = ['FAIL extension/test/bl1275Unlisted.property.test.js > body of the failing assertion'];
    ctx.expectFail = true;
  });

  scoped(/^the injected suite fails three times with different output$/, (ctx) => {
    ctx.bodies = [
      'FAIL extension/test/bl1275First.property.test.js > first distinct body',
      'FAIL extension/test/bl1275Second.property.test.js > second distinct body',
      'FAIL extension/test/bl1275Third.property.test.js > third distinct body',
    ];
    ctx.expectFail = true;
  });

  scoped(/^the injected suite passes$/, (ctx) => {
    ctx.bodies = ['every property held'];
    ctx.expectFail = false;
  });

  scoped(/^the injected suite fails more times than the retention bound allows$/, (ctx) => {
    ctx.keep = SCENARIO_KEEP;
    ctx.bodies = [];
    for (let i = 1; i <= SCENARIO_KEEP + 2; i += 1) {
      ctx.bodies.push(`FAIL extension/test/bl1275Run${i}.property.test.js > body number ${i}`);
    }
    ctx.expectFail = true;
    ctx.statusBefore = git(ctx.root, 'status', '--porcelain');
  });

  scoped(/^the guard runs$/, (ctx) => {
    assert.equal(ctx.bodies.length, 1, 'this scenario drives exactly one run');
    runGuard(ctx, ctx.bodies[0], ctx.expectFail ? 1 : 0);
  });

  scoped(/^the guard runs once for each failure$/, (ctx) => {
    assert.ok(ctx.bodies.length > 1, 'this scenario drives more than one run');
    for (const body of ctx.bodies) {
      runGuard(ctx, body, 1);
    }
  });

  scoped(/^the commit is refused$/, (ctx) => {
    assert.notEqual(ctx.rc, 0, `expected a refusal (non-zero), got 0:\n${ctx.out}`);
  });

  scoped(/^the commit is allowed$/, (ctx) => {
    assert.equal(ctx.rc, 0, `expected the commit allowed (rc 0), got ${ctx.rc}:\n${ctx.out}`);
  });

  scoped(/^the refusal names a path to the retained output$/, (ctx) => {
    const named = namedPath(ctx.out);
    assert.ok(named, `the refusal named no retained-output path:\n${ctx.out}`);
    assert.ok(
      fs.existsSync(named),
      `the refusal named ${named} but nothing is there:\n${ctx.out}`
    );
    ctx.named = named;
  });

  scoped(/^the file at that path contains the injected suite's failing line$/, (ctx) => {
    const body = fs.readFileSync(ctx.named, 'utf8');
    assert.match(
      body,
      /body of the failing assertion/,
      `the retained file does not hold the injected suite's own output:\n${body}`
    );
  });

  scoped(/^all three retained outputs are readable afterwards$/, (ctx) => {
    const logs = retainedLogs(ctx);
    assert.equal(logs.length, 3, `expected 3 retained logs, found ${logs.length}`);
    const bodies = logs.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    for (const needle of ['first distinct body', 'second distinct body', 'third distinct body']) {
      assert.match(bodies, new RegExp(needle), `a refusal's output was clobbered: ${needle} is gone`);
    }
  });

  scoped(/^no output is retained$/, (ctx) => {
    assert.deepEqual(retainedLogs(ctx), [], 'a run with no refusal retained output anyway');
  });

  scoped(/^the tracked working tree is unchanged from before the first run$/, (ctx) => {
    assert.equal(
      git(ctx.root, 'status', '--porcelain'),
      ctx.statusBefore,
      'retention changed what git sees in the working tree'
    );
  });

  scoped(/^only the most recent outputs within the retention bound are kept$/, (ctx) => {
    const logs = retainedLogs(ctx);
    assert.equal(logs.length, SCENARIO_KEEP, `expected ${SCENARIO_KEEP} logs under the bound, found ${logs.length}`);
    const bodies = logs.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    const total = ctx.bodies.length;
    assert.match(bodies, new RegExp(`body number ${total}`), 'the newest refusal was pruned');
    assert.doesNotMatch(bodies, /body number 1\b/, 'the oldest refusal survived the bound');
  });
}

module.exports = { registerSteps };
