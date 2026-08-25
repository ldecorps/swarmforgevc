'use strict';

// BL-1121: reconcile-import skip for property-suite guard (byte-identical MERGE_HEAD).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1121 reconcile import skips the property-suite guard';
const REPO = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');

function git(cwd, args, env = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout || args.join(' '));
  return r;
}

function ensure(ctx) {
  if (!ctx.bl1121) {
    ctx.bl1121 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1121-')),
      out: '',
      status: null,
      envSkip: false,
      suite: 'green',
    };
    git(ctx.bl1121.root, ['init', '-q', '-b', 'main']);
    git(ctx.bl1121.root, ['-c', 'user.email=test@test', '-c', 'user.name=test',
      'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.bl1121;
}

function cleanup(ctx) {
  if (ctx.bl1121?.root) fs.rmSync(ctx.bl1121.root, { recursive: true, force: true });
  ctx.bl1121 = null;
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runGuard(st) {
  const suite =
    st.suite === 'red'
      ? ['bash', '-c', 'echo FAIL extension/test/x.property.test.js >&2; exit 1']
      : ['bash', '-c', 'exit 0'];
  const env = { ...process.env };
  if (st.envSkip) env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD = '1';
  else delete env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
  const r = spawnSync('bash', [GUARD, ...suite], {
    cwd: st.root,
    encoding: 'utf8',
    env,
  });
  st.status = r.status;
  st.out = `${r.stdout || ''}${r.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a mid-merge checkout whose staged extension\/src paths match the incoming parent byte-for-byte$/, (ctx) => {
    const st = ensure(ctx);
    write(st.root, 'extension/src/pipelineBoard.ts', 'base\n');
    git(st.root, ['add', 'extension/src/pipelineBoard.ts']);
    git(st.root, ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'base-ext']);
    git(st.root, ['checkout', '-q', '-b', 'incoming']);
    write(st.root, 'extension/src/pipelineBoard.ts', 'imported\n');
    git(st.root, ['add', 'extension/src/pipelineBoard.ts']);
    git(st.root, ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'incoming-ext']);
    const incoming = spawnSync('git', ['-C', st.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    assert.equal(incoming.status, 0);
    git(st.root, ['checkout', '-q', 'main']);
    write(st.root, 'docs/local.txt', 'local\n');
    git(st.root, ['add', 'docs/local.txt']);
    git(st.root, ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'local-docs']);
    git(st.root, ['-c', 'user.email=test@test', '-c', 'user.name=test',
      'merge', '--no-commit', '--no-ff', incoming.stdout.trim()]);
    st.suite = 'red';
    st.envSkip = false;
  });

  scoped(/^a non-merge checkout with a staged extension\/src edit$/, (ctx) => {
    cleanup(ctx);
    const st = ensure(ctx);
    write(st.root, 'extension/src/pipelineBoard.ts', 'fresh\n');
    git(st.root, ['add', 'extension/src/pipelineBoard.ts']);
    st.envSkip = false;
  });

  scoped(/^the property-suite guard runs against a red injectable suite$/, (ctx) => {
    ensure(ctx).suite = 'red';
    runGuard(ensure(ctx));
  });

  scoped(/^the property-suite guard runs against a green injectable suite$/, (ctx) => {
    ensure(ctx).suite = 'green';
    runGuard(ensure(ctx));
  });

  scoped(/^the property-suite guard runs with SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 against a red suite$/, (ctx) => {
    const st = ensure(ctx);
    st.suite = 'red';
    st.envSkip = true;
    runGuard(st);
  });

  scoped(/^it exits 0$/, (ctx) => {
    assert.equal(ensure(ctx).status, 0, ensure(ctx).out);
  });

  scoped(/^it prints skip-reconcile-import$/, (ctx) => {
    assert.match(ensure(ctx).out, /skip-reconcile-import/);
  });

  scoped(/^it does not print property-suite-guard: run$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).out, /property-suite-guard: run/);
  });

  scoped(/^it prints property-suite-guard: run$/, (ctx) => {
    assert.match(ensure(ctx).out, /property-suite-guard: run/);
  });

  scoped(/^it does not print skip-reconcile-import$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).out, /skip-reconcile-import/);
  });

  scoped(/^it prints overridden$/, (ctx) => {
    assert.match(ensure(ctx).out, /overridden/i);
  });

  scoped(/^it does not print overridden$/, (ctx) => {
    assert.doesNotMatch(ensure(ctx).out, /overridden/i);
  });
}

module.exports = { registerSteps };
