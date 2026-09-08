'use strict';

// BL-1373: step handlers for "The sweep reads the path set it is told".
// These scenarios verify the two invariants from the ticket:
// 1. The classified path set is whatever BL-632's single source reports at runtime
// 2. A path the single source does not report produces no finding
//
// The implementation reuses the same fixture pattern as BL-631 scenario 07.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { track, reap } = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BABYSITTER_CHECK = path.join(SCRIPTS, 'babysitter_check.bb');

const FEATURE = 'The sweep reads the path set it is told';

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function mkTmp(prefix) {
  const root = mkSocketFixtureRoot(prefix);
  trackedRoots.push(root);
  return root;
}

function mkFixtureRepo() {
  const root = mkTmp('sfvc-bl1373-');
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

function runSweep(root, { env = {} } = {}) {
  const args = [BABYSITTER_CHECK, root];
  try {
    const stdout = execFileSync('bb', args, { encoding: 'utf8', env: { ...process.env, ...env } });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

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

function createStubScript(paths) {
  const stubDir = mkTmp('sfvc-bl1373-stub-');
  const stub = path.join(stubDir, 'stub-list-paths.sh');
  const pathsList = paths.map((p) => `printf '%s\\n' "${p}"`).join('\n');
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\nif [[ "\${1:-}" == "--list-paths" ]]; then\n  ${pathsList}\n  exit 0\nfi\nexit 0\n`
  );
  fs.chmodSync(stub, 0o755);
  return stub;
}

function registerSteps(registry) {
  // Background
  registry.defineScoped(
    /^the QA-exclusive path set is reported by BL-632's single source$/,
    () => {
      // No-op: this is just context setting
    },
    FEATURE
  );

  // Scenario 01
  registry.defineScoped(
    /^the single source reports a path set the sweep has never seen$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      ctx.stubPaths = ['docs/custom-secret.md', 'internal/restricted/'];
      ctx.stubScript = createStubScript(ctx.stubPaths);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touches only a path from that reported set$/,
    (ctx) => {
      ctx.sha = commitFile(ctx.root, 'docs/custom-secret.md', 'secret\n', 'coder: touches stub path');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the babysitter sweep runs$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: ctx.stubScript } });
      ctx.findings = pipelineFindings(ctx.result.output);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit fires a critical finding$/,
    (ctx) => {
      const finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(finding, `expected a critical finding for ${ctx.sha}, got:\n${ctx.result.output}`);
      assert.equal(finding.severity, 'CRIT');
    },
    FEATURE
  );

  // Scenario 02
  registry.defineScoped(
    /^the single source reports a path set that excludes a path$/,
    (ctx) => {
      ctx.root = mkFixtureRepo();
      ctx.stubPaths = ['docs/custom-secret.md'];
      ctx.stubScript = createStubScript(ctx.stubPaths);
      ctx.excludedPath = 'extension/src/foo.ts';
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touches only that excluded path$/,
    (ctx) => {
      ctx.sha = commitFile(ctx.root, ctx.excludedPath, 'code\n', 'coder: touches excluded path');
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit produces no finding$/,
    (ctx) => {
      const finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(!finding, `expected NO finding for ${ctx.sha} (excluded path), got:\n${ctx.result.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
