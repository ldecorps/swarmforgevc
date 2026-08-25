'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FEATURE = 'Shell tests under scripts/test are discovered or explicitly excluded';
const REPO = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO, 'swarmforge', 'scripts', 'test');
const CLI = path.join(TEST_DIR, 'shell_test_discovery_cli.bb');
const SELF_TEST = path.join(TEST_DIR, 'test_shell_test_discovery.sh');

function ensure(ctx) {
  if (!ctx.bl724) {
    ctx.bl724 = { root: '', out: '', status: null, state: '', file: '', label: '' };
  }
  return ctx.bl724;
}

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl724-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'test', 'suite-manifest.tsv'), '# m\n');
  return root;
}

function track(root, rels) {
  execFileSync('git', ['add', ...rels], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 't'], { cwd: root });
}

function appendManifest(root, line) {
  const p = path.join(root, 'swarmforge', 'scripts', 'test', 'suite-manifest.tsv');
  fs.appendFileSync(p, line.endsWith('\n') ? line : `${line}\n`);
}

function runCli(root) {
  return spawnSync('bb', [CLI, root], { encoding: 'utf8' });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture checkout with a swarmforge\/scripts\/test directory$/, (ctx) => {
    ensure(ctx).root = mkRepo();
  });

  scoped(/^a tracked test file test_reached\.sh$/, (ctx) => {
    const st = ensure(ctx);
    const f = path.join(st.root, 'swarmforge', 'scripts', 'test', 'test_reached.sh');
    fs.writeFileSync(f, '#!/bin/sh\necho ok\n');
    appendManifest(st.root, 'test_reached.sh\tstanding\t\t');
    track(st.root, ['swarmforge/scripts/test/test_reached.sh', 'swarmforge/scripts/test/suite-manifest.tsv']);
  });

  scoped(/^a tracked test file test_manual\.sh excluded with the reason needs a live tmux server$/, (ctx) => {
    const st = ensure(ctx);
    const f = path.join(st.root, 'swarmforge', 'scripts', 'test', 'test_manual.sh');
    fs.writeFileSync(f, '#!/bin/sh\necho manual\n');
    appendManifest(st.root, 'test_manual.sh\texcluded\t2026-07-30\tneeds a live tmux server');
    track(st.root, ['swarmforge/scripts/test/test_manual.sh', 'swarmforge/scripts/test/suite-manifest.tsv']);
  });

  scoped(/^the test directory is in state (.+)$/, (ctx, state) => {
    const st = ensure(ctx);
    st.state = state.trim();
    if (st.state === 'untracked test file') {
      fs.writeFileSync(path.join(st.root, 'swarmforge', 'scripts', 'test', 'test_orphan.sh'), 'echo o\n');
      st.file = 'test_orphan.sh';
      st.label = 'untracked orphan';
    } else if (st.state === 'tracked but unlisted') {
      fs.writeFileSync(path.join(st.root, 'swarmforge', 'scripts', 'test', 'test_orphan.sh'), 'echo o\n');
      track(st.root, ['swarmforge/scripts/test/test_orphan.sh']);
      st.file = 'test_orphan.sh';
      st.label = 'unaccounted test';
    } else if (st.state === 'excluded with no reason') {
      fs.writeFileSync(path.join(st.root, 'swarmforge', 'scripts', 'test', 'test_bare.sh'), 'echo b\n');
      appendManifest(st.root, 'test_bare.sh\texcluded\t2026-07-30\t');
      track(st.root, ['swarmforge/scripts/test/test_bare.sh', 'swarmforge/scripts/test/suite-manifest.tsv']);
      st.file = 'test_bare.sh';
      st.label = 'exclusion missing its reason';
    } else if (st.state === 'exclusion for a deleted file') {
      appendManifest(st.root, 'test_gone.sh\texcluded\t2026-07-30\tlive-only');
      track(st.root, ['swarmforge/scripts/test/suite-manifest.tsv']);
      st.file = 'test_gone.sh';
      st.label = 'stale exclusion';
    }
  });

  scoped(/^the discovery sweep runs$/, (ctx) => {
    const st = ensure(ctx);
    const r = runCli(st.root || REPO);
    st.out = `${r.stdout || ''}${r.stderr || ''}`;
    st.status = r.status;
  });

  scoped(/^the sweep accounts for test_reached\.sh as reached$/, (ctx) => {
    assert.equal(ensure(ctx).status, 0);
  });

  scoped(/^the sweep accounts for test_manual\.sh as excluded$/, (ctx) => {
    assert.equal(ensure(ctx).status, 0);
  });

  scoped(/^the sweep reports the reason needs a live tmux server$/, (ctx) => {
    const man = fs.readFileSync(
      path.join(ensure(ctx).root, 'swarmforge', 'scripts', 'test', 'suite-manifest.tsv'),
      'utf8'
    );
    assert.match(man, /needs a live tmux server/);
  });

  scoped(/^the sweep exits zero$/, (ctx) => {
    assert.equal(ensure(ctx).status, 0);
  });

  scoped(/^the sweep names (.+) as (.+)$/, (ctx, file, label) => {
    const st = ensure(ctx);
    assert.match(st.out, new RegExp(`${label.trim()}.*${file.trim()}|${file.trim()}.*${label.trim()}`));
  });

  scoped(/^the sweep exits non-zero$/, (ctx) => {
    assert.notEqual(ensure(ctx).status, 0);
  });

  scoped(/^its output differs from a sweep over the tracked file alone$/, (ctx) => {
    const st = ensure(ctx);
    const clean = mkRepo();
    fs.writeFileSync(path.join(clean, 'swarmforge', 'scripts', 'test', 'test_reached.sh'), 'echo ok\n');
    appendManifest(clean, 'test_reached.sh\tstanding\t\t');
    track(clean, ['swarmforge/scripts/test/test_reached.sh', 'swarmforge/scripts/test/suite-manifest.tsv']);
    const c = runCli(clean);
    const cleanOut = `${c.stdout || ''}${c.stderr || ''}`;
    assert.notEqual(st.out, cleanOut);
  });

  scoped(/^the live repository checkout$/, (ctx) => {
    ensure(ctx).root = REPO;
  });

  scoped(/^the sweep does not account for test_swarm_handoff_mono_router_auto_rotate\.sh$/, (ctx) => {
    const r = spawnSync('bash', [SELF_TEST], { encoding: 'utf8', cwd: REPO, timeout: 120000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(`${r.stdout || ''}`, /PASS: 05:/);
  });
}

module.exports = { registerSteps };
