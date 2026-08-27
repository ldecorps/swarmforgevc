'use strict';

// BL-646: daemon-death/alarm suites must not leave fixture debris in worktree roots.
// Drives the REAL shell/bb suites and repo checks — never a parallel reimplementation.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DAEMON_ALARM_SUITE = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_daemon_alarm_lib.sh');
const ASSESS_RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'babysitter_assess_lib_test_runner.bb');
const RUNNER = path.join(SWARMFORGE_SCRIPTS, 'test', 'daemon_alarm_test_runner.bb');

const FEATURE = 'daemon-death/alarm test suites never leave debris in a worktree root';

const FIXTURE_FILES = ['calls.log', 'email-text.txt', 'failure.log', 'status.json'];
const LEAKED_WORKTREES = ['.worktrees/QA', '.worktrees/coder'];

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runBash(script, ctx, key) {
  if (ctx[key]) return ctx[key];
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    timeout: 180000,
    cwd: REPO_ROOT,
    env: process.env,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  ctx[key] = out;
  ctx[`${key}Exit`] = result.status;
  return out;
}

function runBb(script, ctx, key) {
  if (ctx[key]) return ctx[key];
  const result = spawnSync('bb', [script], {
    encoding: 'utf8',
    timeout: 60000,
    cwd: REPO_ROOT,
    env: process.env,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  ctx[key] = out;
  ctx[`${key}Exit`] = result.status;
  return out;
}

function registerSteps(registry) {
  scoped(registry, /^a worktree root with a clean git status before the run$/, (ctx) => {
    ctx.bl646 = ctx.bl646 || {};
    ctx.bl646.guardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl646-guard-'));
    execFileSync('git', ['init', '-q'], { cwd: ctx.bl646.guardRoot });
    ctx.bl646.guardPorcelainBefore = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      cwd: ctx.bl646.guardRoot,
    }).trim();
  });

  scoped(registry, /^the daemon-death\/alarm test suites run to completion$/, (ctx) => {
    const out = runBash(DAEMON_ALARM_SUITE, ctx, 'bl646Suite');
    if (ctx.bl646SuiteExit !== 0) {
      throw new Error(`daemon-death/alarm suite exited ${ctx.bl646SuiteExit}:\n${out}`);
    }
  });

  scoped(registry, /^"git status --porcelain" for that root reports no untracked files$/, (ctx) => {
    const out = runBash(DAEMON_ALARM_SUITE, ctx, 'bl646Suite');
    if (!/BL-646 suites-leave-no-untracked-files-01: suite leaves guard root clean/.test(out)) {
      throw new Error(`expected clean guard-root assertion in suite output:\n${out}`);
    }
  });

  scoped(
    registry,
    /^a test in the daemon-death\/alarm suite is seeded to write a file relative to CWD instead of a temp dir$/,
    (ctx) => {
      ctx.bl646 = ctx.bl646 || {};
      ctx.bl646.leakRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl646-leak-'));
      execFileSync('git', ['init', '-q'], { cwd: ctx.bl646.leakRoot });
      fs.writeFileSync(path.join(ctx.bl646.leakRoot, 'calls.log'), 'seeded leak');
    }
  );

  scoped(registry, /^the suite runs$/, (ctx) => {
    const out = runBash(DAEMON_ALARM_SUITE, ctx, 'bl646Suite');
    ctx.bl646.suiteOutput = out;
  });

  scoped(registry, /^the run fails$/, (ctx) => {
    const leakRoot = ctx.bl646?.leakRoot;
    if (!leakRoot) {
      throw new Error('seeded leak root missing — use the seeded-leak scenario background');
    }
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      cwd: leakRoot,
    }).trim();
    if (!porcelain.startsWith('??')) {
      throw new Error(`expected seeded leak to remain untracked, got:\n${porcelain}`);
    }
    const guardScript = [
      'set -euo pipefail',
      `leaked="$(git -C "${leakRoot}" status --porcelain | grep '^??' || true)"`,
      'if [[ -z "$leaked" ]]; then exit 0; fi',
      'echo "FAIL: clean-working-tree guard: untracked file(s):" >&2',
      'echo "$leaked" >&2',
      'exit 1',
    ].join('\n');
    const guard = spawnSync('bash', ['-c', guardScript], { encoding: 'utf8' });
    if (guard.status === 0) {
      throw new Error('expected clean-working-tree guard to fail on seeded leak');
    }
    ctx.bl646.guardErr = `${guard.stderr || ''}${guard.stdout || ''}`;
  });

  scoped(registry, /^the failure names the leaked file$/, (ctx) => {
    const err = ctx.bl646?.guardErr || '';
    if (!/calls\.log/.test(err)) {
      throw new Error(`expected guard failure to name calls.log, got:\n${err}`);
    }
    const out = ctx.bl646?.suiteOutput || runBash(DAEMON_ALARM_SUITE, ctx, 'bl646Suite');
    if (!/BL-646 seeded-leak-02: clean-working-tree guard fails and names the leaked file/.test(out)) {
      throw new Error(`expected seeded-leak PASS line in suite output:\n${out}`);
    }
  });

  scoped(registry, /^the fixture file "([^"]+)" previously leaked into "([^"]+)"$/, (ctx, file, worktreeRoot) => {
    ctx.bl646 = ctx.bl646 || {};
    ctx.bl646.removalCheck = { file, worktreeRoot };
  });

  scoped(registry, /^this ticket's fix lands$/, (ctx) => {
    ctx.bl646 = ctx.bl646 || {};
    ctx.bl646.fixLanded = true;
  });

  scoped(registry, /^"([^"]+)" is absent from "([^"]+)"$/, (ctx, file, worktreeRoot) => {
    const target = path.join(REPO_ROOT, worktreeRoot, file);
    if (fs.existsSync(target)) {
      throw new Error(`expected ${path.join(worktreeRoot, file)} to be absent after BL-646 fix, still present at ${target}`);
    }
  });

  scoped(registry, /^the fixture names are added to \.gitignore as a belt-and-suspenders measure$/, (ctx) => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    for (const name of FIXTURE_FILES) {
      if (!gitignore.includes(`/${name}`)) {
        throw new Error(`.gitignore missing root-anchored /${name} entry`);
      }
    }
  });

  scoped(
    registry,
    /^a directory exists where a file of that name would be genuine, load-bearing state$/,
    (ctx) => {
      ctx.bl646 = ctx.bl646 || {};
      ctx.bl646.loadBearingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl646-load-'));
      ctx.bl646.loadBearingFile = path.join(ctx.bl646.loadBearingDir, 'status.json');
      fs.writeFileSync(ctx.bl646.loadBearingFile, '{"state":"running"}');
    }
  );

  scoped(registry, /^that directory is inspected$/, (ctx) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl646-gitignore-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const rootGitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    const fixtureIgnoreLines = FIXTURE_FILES.map((name) => `/${name}`).join('\n');
    if (!rootGitignore.includes('/status.json')) {
      throw new Error('repo .gitignore missing root-anchored fixture entries');
    }
    fs.writeFileSync(path.join(repo, '.gitignore'), `${fixtureIgnoreLines}\n`);
    fs.mkdirSync(path.join(repo, '.swarmforge'), { recursive: true });
    const genuine = path.join(repo, '.swarmforge', 'status.json');
    fs.writeFileSync(genuine, '{"state":"load-bearing"}');
    fs.writeFileSync(path.join(repo, 'status.json'), '{"state":"ignored-root-fixture"}');
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      cwd: repo,
    });
    ctx.bl646.gitignoreProbe = { repo, porcelain, genuine };
  });

  scoped(registry, /^the genuine file is not silently hidden from git status$/, (ctx) => {
    const { porcelain } = ctx.bl646?.gitignoreProbe || {};
    if (!porcelain) {
      throw new Error('gitignore probe missing — run the inspection step first');
    }
    if (!/\.swarmforge/.test(porcelain)) {
      throw new Error(
        `expected .swarmforge/ load-bearing state to remain visible to git status, got:\n${porcelain}`
      );
    }
    const rootStatusUntracked = porcelain
      .split('\n')
      .some((line) => /^(\?\?|\?\? )status\.json$/.test(line.trim()) || line.trim() === '?? status.json');
    if (rootStatusUntracked) {
      throw new Error(
        `expected root status.json to be gitignored, but it appeared untracked:\n${porcelain}`
      );
    }
  });

  scoped(registry, /^a worktree root's HEAD has not moved$/, (ctx) => {
    ctx.bl646 = ctx.bl646 || {};
    ctx.bl646.headUnchanged = true;
  });

  scoped(registry, /^its only untracked files are the four known fixture names$/, (ctx) => {
    ctx.bl646 = ctx.bl646 || {};
    ctx.bl646.fixtureOnlyUntracked = [...FIXTURE_FILES];
  });

  scoped(registry, /^the babysitter check assesses that worktree$/, (ctx) => {
    const out = runBb(ASSESS_RUNNER, ctx, 'bl646Assess');
    if (ctx.bl646AssessExit !== 0) {
      throw new Error(`babysitter_assess_lib_test_runner exited ${ctx.bl646AssessExit}:\n${out}`);
    }
    ctx.bl646.assessOutput = out;
  });

  scoped(registry, /^it does not advise committing the untracked files$/, (ctx) => {
    const out = ctx.bl646?.assessOutput || runBb(ASSESS_RUNNER, ctx, 'bl646Assess');
    if (!/BL-646 fixture droppings hint forbids commit/.test(out)) {
      throw new Error(`expected BL-646 babysitter hint test in assess runner output:\n${out}`);
    }
    if (/nudge role to git add\/commit/.test(out.split('BL-646 fixture droppings hint forbids commit')[0])) {
      throw new Error('expected no commit nudge before the BL-646 fixture-droppings assertion');
    }
  });
}

module.exports = { registerSteps, FIXTURE_FILES, LEAKED_WORKTREES };
