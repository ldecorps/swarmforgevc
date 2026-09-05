'use strict';

// BL-1112: restore green for sampleResourcesCli + strykerSandboxSiblingsLib.
// Sample-resources half drives the REAL compiled main() with the same fixture
// shape as extension/test/sampleResourcesCli.test.js. Stryker half drives
// ensureStrykerSandboxSiblingLink per Outline sibling.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ensureStrykerSandboxSiblingLink,
} = require('../../../extension/scripts/strykerSandboxSiblingsLib.js');
const { formatSampleResult, main } = require('../../../extension/out/tools/sample-resources');
const { installInProcessTmux } = require('../../../extension/test/helpers/fakeTmux');
const { spawnFakeAgentTree } = require('../../../extension/test/helpers/fakeAgentTree');
const { copySeededRepoInto } = require('../../../extension/test/helpers/sharedRepoFixture');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1112 standing unit reds in sampleResourcesCli and strykerSandboxSiblingsLib';

const KNOWN_SIBLINGS = new Set(['pwa', 'swarmforge', '.github', 'docs']);

function isolatedEnv() {
  const env = { ...process.env, SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD: '1' };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: isolatedEnv() });
}

function initSampleFixture() {
  const root = fs.realpathSync(mkTmpDir('bl1112-sample-'));
  copySeededRepoInto(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  return root;
}

function runMain(root) {
  const originalCwd = process.cwd;
  const savedGitDir = process.env.GIT_DIR;
  const savedGitWorkTree = process.env.GIT_WORK_TREE;
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    process.cwd = () => root;
    main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    if (savedGitDir !== undefined) process.env.GIT_DIR = savedGitDir;
    else delete process.env.GIT_DIR;
    if (savedGitWorkTree !== undefined) process.env.GIT_WORK_TREE = savedGitWorkTree;
    else delete process.env.GIT_WORK_TREE;
  }
  return logs.join('\n');
}

function telemetryPath(root) {
  const monthKey = new Date().toISOString().slice(0, 7);
  return path.join(root, '.swarmforge', 'telemetry', `chaser-${monthKey}.jsonl`);
}

function readTelemetryLines(root) {
  try {
    return fs
      .readFileSync(telemetryPath(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function cleanupSample(ctx) {
  if (ctx.bl1112Sample?.fake) ctx.bl1112Sample.fake.restore();
  if (ctx.bl1112Sample?.agentTree) ctx.bl1112Sample.agentTree.kill();
  if (ctx.bl1112Sample?.root) fs.rmSync(ctx.bl1112Sample.root, { recursive: true, force: true });
  ctx.bl1112Sample = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the extension unit suite is run from extension\/ with swarm\.env loaded$/, (ctx) => {
    ctx.bl1112Ready = true;
    assert.equal(typeof formatSampleResult, 'function');
  });

  scoped(/^a fixture where one role has a resource sample available$/, (ctx) => {
    const root = initSampleFixture();
    const agentTree = spawnFakeAgentTree();
    const fake = installInProcessTmux([
      { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
      { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
      { subcommand: 'display-message', exitCode: 0, stdout: `${agentTree.shellPid}\n` },
    ]);
    ctx.bl1112Sample = { root, agentTree, fake, mode: 'sample' };
  });

  scoped(/^sampleResourcesCli runs in-process$/, (ctx) => {
    const st = ctx.bl1112Sample;
    st.output = runMain(st.root);
  });

  scoped(/^the output includes SAMPLED 1 role\(s\)$/, (ctx) => {
    try {
      assert.match(ctx.bl1112Sample.output, /^SAMPLED 1 role\(s\)/);
    } finally {
      cleanupSample(ctx);
    }
  });

  scoped(/^a clean sampleResources telemetry fixture$/, (ctx) => {
    const root = initSampleFixture();
    const agentTree = spawnFakeAgentTree();
    const fake = installInProcessTmux([
      { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
      { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
      { subcommand: 'display-message', exitCode: 0, stdout: `${agentTree.shellPid}\n` },
    ]);
    ctx.bl1112Sample = { root, agentTree, fake, mode: 'telemetry' };
  });

  scoped(/^a resource sample is recorded for one role$/, (ctx) => {
    const st = ctx.bl1112Sample;
    st.output = runMain(st.root);
    st.lines = readTelemetryLines(st.root);
  });

  scoped(/^the telemetry line count matches the suite's expected count for that case$/, (ctx) => {
    try {
      assert.match(ctx.bl1112Sample.output, /^SAMPLED 1 role\(s\)/);
      // Clean fixture: one resource_sample + one host_load_sample (BL-822).
      assert.equal(ctx.bl1112Sample.lines.length, 2, JSON.stringify(ctx.bl1112Sample.lines));
    } finally {
      cleanupSample(ctx);
    }
  });

  scoped(/^an extension temp dir whose (\S+) symlink points at a removed path$/, (ctx, sibling) => {
    assert.ok(KNOWN_SIBLINGS.has(sibling), `unknown <sibling>: ${sibling}`);
    const root = mkSocketFixtureRoot('bl1112-stryker-');
    const extensionDir = path.join(root, 'extension');
    const siblingDir = path.join(root, sibling);
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, 'marker'), `${sibling}-live`);
    const tempDir = path.join(extensionDir, '.stryker-tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.symlinkSync('/no/such/path', path.join(tempDir, sibling), 'dir');
    ctx.bl1112Stryker = { root, extensionDir, siblingDir, sibling };
  });

  scoped(/^ensureStrykerSandboxSiblingLink runs for that sibling$/, (ctx) => {
    const st = ctx.bl1112Stryker;
    try {
      st.result = ensureStrykerSandboxSiblingLink(st.extensionDir, '.stryker-tmp', st.sibling);
      st.error = null;
    } catch (err) {
      st.result = null;
      st.error = err;
    }
  });

  scoped(/^the symlink is recreated to the live sibling target$/, (ctx) => {
    const st = ctx.bl1112Stryker;
    assert.equal(st.error, null, st.error && st.error.stack);
    assert.equal(st.result.created, true);
    assert.equal(fs.realpathSync(st.result.linkPath), fs.realpathSync(st.siblingDir));
  });

  scoped(/^the call does not throw EEXIST$/, (ctx) => {
    const st = ctx.bl1112Stryker;
    try {
      assert.equal(st.error, null, st.error && st.error.message);
      assert.doesNotMatch(String(st.error || ''), /EEXIST/);
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
