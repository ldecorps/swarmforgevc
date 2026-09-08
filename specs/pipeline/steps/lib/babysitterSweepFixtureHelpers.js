'use strict';

// Shared fixture helpers for babysitter sweep acceptance tests (BL-631, BL-1373).
// These functions are common to multiple step-handler files that drive
// babysitter_check.bb against disposable git fixture repos.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { track, reap } = require('./fixtureReaper');
const { mkSocketFixtureRoot } = require('./socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');

// Tracked fixture roots for teardown. Each step-handler file that imports
// this module gets its own trackedRoots array (module-level state is per-import).
// The afterEach hook in each file is responsible for calling reapAndRemove().
let trackedRoots = [];

function getTrackedRoots() {
  return trackedRoots;
}

function trackRoot(root) {
  trackedRoots.push(root);
}

function reapAndRemove() {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd, args, extraEnv) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

function mkTmp(prefix) {
  const root = mkSocketFixtureRoot(prefix);
  trackedRoots.push(root);
  return root;
}

function mkFixtureRepo(prefix = 'sfvc-babysitter-') {
  const root = mkTmp(prefix);
  fs.writeFileSync(path.join(root, 'README.md'), 'init\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', 'swarmforge-QA']);
  return root;
}

function commitFile(root, relPath, content, subject) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', subject]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function runSweep(root, { nudge = false, env = {} } = {}) {
  const args = [BABYSITTER_CHECK, root];
  if (nudge) args.push('--nudge');
  try {
    const stdout = execFileSync('bb', args, { encoding: 'utf8', env: { ...process.env, ...env } });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// Parses babysitterd-sweep-lib/format-finding-line's own output shape:
// "<ts> <SEVERITY> [<key>] <message>".
const FINDING_LINE_RE = /^\S+ (\S+) \[([^\]]+)\] (.*)$/;

function parseFindings(output) {
  return output
    .split('\n')
    .map((line) => line.match(FINDING_LINE_RE))
    .filter(Boolean)
    .map((m) => ({ severity: m[1], key: m[2], message: m[3] }));
}

function pipelineFindings(output) {
  return parseFindings(output).filter((f) => f.key.startsWith('pipeline-code-on-main'));
}

// Creates a stub script that returns a fixed list of paths when called with --list-paths.
// Used by BL-631 scenario 07 and BL-1373 to test that the sweep reads the path set
// from the single source at runtime, not from a cached or hardcoded value.
function createStubScript(paths, prefix = 'sfvc-babysitter-stub-') {
  const stubDir = mkTmp(prefix);
  const stub = path.join(stubDir, 'stub-list-paths.sh');
  const pathsList = paths.map((p) => `printf '%s\\n' "${p}"`).join('\n');
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\nif [[ "\${1:-}" == "--list-paths" ]]; then\n  ${pathsList}\n  exit 0\nfi\nexit 0\n`
  );
  fs.chmodSync(stub, 0o755);
  return stub;
}

module.exports = {
  REPO_ROOT,
  SCRIPTS,
  BABYSITTER_CHECK,
  getTrackedRoots,
  trackRoot,
  reapAndRemove,
  git,
  mkTmp,
  mkFixtureRepo,
  commitFile,
  runSweep,
  FINDING_LINE_RE,
  parseFindings,
  pipelineFindings,
  createStubScript,
};
