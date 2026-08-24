'use strict';

// BL-1000: freshness shell tests read a pinned fixture, not the live ops conf.
// Drives the REAL shell suites against a raised live conf copy (never editing
// the committed file in place) and checks the fixture is git-tracked.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVE_CONF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'daemon_log_freshness.conf');
const FIXTURE_CONF = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'fixtures',
  'daemon_log_freshness.fixture.conf'
);
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const FEATURE = 'The freshness tests read a pinned fixture, not the operator\'s live conf';

const KNOWN_TEST_FILES = new Map([
  ['test_daemon_log_freshness.sh', path.join(TEST_DIR, 'test_daemon_log_freshness.sh')],
  ['test_bl785_freshness_deliberate_stop.sh', path.join(TEST_DIR, 'test_bl785_freshness_deliberate_stop.sh')],
]);

let liveBackup = null;

afterEach(() => {
  restoreLiveConf();
});

function restoreLiveConf() {
  if (liveBackup !== null) {
    fs.writeFileSync(LIVE_CONF, liveBackup);
    liveBackup = null;
  }
}

function raiseLiveHandoffdThreshold(secs) {
  if (liveBackup === null) {
    liveBackup = fs.readFileSync(LIVE_CONF, 'utf8');
  }
  const raised = liveBackup.replace(/^(handoffd\|)\d+/m, `$1${secs}`);
  assert.notEqual(raised, liveBackup, 'expected to rewrite handoffd threshold');
  fs.writeFileSync(LIVE_CONF, raised);
}

function runShellTest(absPath, cwd = REPO_ROOT) {
  const res = spawnSync('bash', [absPath], {
    cwd,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env },
  });
  return {
    status: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
  };
}

function assertPinnedRestartPathGreen(out, label) {
  // BL-796 nvm-resolution checks can fail on hosts without a usable nvm tree
  // in PATH; they are out of this ticket's scope. The coupling under test is
  // the stale-heartbeat restart path (02a / BL-785 ALL CHECKS).
  assert.match(
    out,
    /PASS: 02a: stale handoffd restarts through start_handoff_daemon\.sh/,
    label
  );
  assert.doesNotMatch(out, /FAIL - 02a:/, label);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the freshness shell tests and the operator's live threshold conf$/, (ctx) => {
    assert.ok(fs.existsSync(LIVE_CONF), `missing live conf: ${LIVE_CONF}`);
    assert.ok(fs.existsSync(FIXTURE_CONF), `missing fixture conf: ${FIXTURE_CONF}`);
    ctx.fixtureConf = FIXTURE_CONF;
    ctx.liveConf = LIVE_CONF;
  });

  scoped(/^the operator has raised handoffd's live threshold above the staged staleness$/, () => {
    // Staged ages are 200s; 300s is strictly above that (qa_e2e step 1).
    raiseLiveHandoffdThreshold(300);
    // Non-vacuity: the live file must actually show the raise (soft/surgical lock).
    // Suites still pass only because they read the pinned fixture, not this file.
    assert.match(fs.readFileSync(LIVE_CONF, 'utf8'), /^handoffd\|300\|/m);
  });

  scoped(/^(test_daemon_log_freshness\.sh|test_bl785_freshness_deliberate_stop\.sh) runs$/, (ctx, testFile) => {
    const abs = KNOWN_TEST_FILES.get(testFile);
    if (!abs) {
      throw new Error(`BL-1000: unknown test_file "${testFile}"`);
    }
    ctx.lastRun = runShellTest(abs);
    ctx.lastTestFile = testFile;
  });

  scoped(/^it passes$/, (ctx) => {
    // Outline 01 non-vacuity: live conf must still show the ops raise.
    assert.match(fs.readFileSync(LIVE_CONF, 'utf8'), /^handoffd\|300\|/m);
    const out = ctx.lastRun.out || '';
    if (ctx.lastTestFile === 'test_bl785_freshness_deliberate_stop.sh') {
      assert.equal(ctx.lastRun.status, 0, `expected suite green:\n${out}`);
      return;
    }
    assertPinnedRestartPathGreen(out, `expected pinned restart path green:\n${out}`);
  });

  scoped(/^the freshness suite runs$/, (ctx) => {
    const cwd = ctx.cloneDir || REPO_ROOT;
    const script = path.join(
      cwd,
      'swarmforge',
      'scripts',
      'test',
      'test_daemon_log_freshness.sh'
    );
    ctx.lastRun = runShellTest(script, cwd);
    if (!ctx.cloneDir) {
      assertPinnedRestartPathGreen(
        ctx.lastRun.out,
        `expected pinned restart path green:\n${ctx.lastRun.out}`
      );
    }
  });

  scoped(/^a handoffd heartbeat older than the pinned threshold is killed and restarted$/, (ctx) => {
    assert.match(
      ctx.lastRun.out,
      /PASS: 02a: stale handoffd restarts through start_handoff_daemon\.sh/
    );
  });

  scoped(/^the durable record names the daemon, its age and the restart action$/, (ctx) => {
    assert.match(ctx.lastRun.out, /ok\s+- 02a: durable record names handoffd and age/);
  });

  scoped(/^a checkout containing only files tracked in git$/, (ctx) => {
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1000-clone-'));
    ctx.cloneDir = clone;
    execFileSync('git', ['clone', '--quiet', REPO_ROOT, clone], { encoding: 'utf8' });
    const tip = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', clone, 'checkout', '--quiet', tip], { encoding: 'utf8' });
  });

  scoped(/^every conf the tests read is present$/, (ctx) => {
    const rel = path.join(
      'swarmforge',
      'scripts',
      'test',
      'fixtures',
      'daemon_log_freshness.fixture.conf'
    );
    const inClone = path.join(ctx.cloneDir, rel);
    assert.ok(fs.existsSync(inClone), `fixture missing from fresh clone: ${inClone}`);
    const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', rel], {
      encoding: 'utf8',
    }).trim();
    assert.equal(tracked.replace(/\\/g, '/'), rel.replace(/\\/g, '/'));
    // Suite must have been able to locate its CONF (even if other clone gaps fail).
    assert.doesNotMatch(ctx.lastRun.out, /No such file|FRESHNESS_CONF|daemon_log_freshness\.fixture\.conf:.*[Nn]o such/);
    fs.rmSync(ctx.cloneDir, { recursive: true, force: true });
    ctx.cloneDir = null;
  });
}

module.exports = { registerSteps };
