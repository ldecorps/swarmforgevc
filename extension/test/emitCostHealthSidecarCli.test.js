const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cost-health-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, 'docs', 'briefings'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  return root;
}

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'emit-cost-health-sidecar.js');

function commitCount(root, filePath) {
  return git(root, ['log', '--oneline', '--', filePath]).trim().split('\n').filter(Boolean).length;
}

// BL-272 headless-cost-health-sidecar-01: the compiled CLI runs the SAME
// compute -> write -> commit path extension.ts's onBriefingDue calls
// in-process, with no VS Code host - it emits and commits today's sidecar.
test('the compiled CLI emits and commits today\'s cost & health sidecar', () => {
  const root = initFixture();
  const output = execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
  assert.match(output, /^EMITTED /);

  const briefingsDir = path.join(root, 'docs', 'briefings');
  const jsonFiles = fs.readdirSync(briefingsDir).filter((f) => f.endsWith('.json'));
  assert.equal(jsonFiles.length, 1, `expected exactly one sidecar file, got: ${jsonFiles.join(', ')}`);

  const sidecarPath = path.join(briefingsDir, jsonFiles[0]);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.equal(typeof sidecar.schemaVersion, 'number');
  assert.ok(sidecar.dateIso);

  assert.equal(commitCount(root, path.join('docs', 'briefings', jsonFiles[0])), 1);
});

// BL-272 headless-cost-health-sidecar-03: re-running against an unchanged
// day makes no duplicate commit - commitCostHealthSidecar's existing
// fails-closed `git commit` no-op, exercised end-to-end through the CLI.
test('running the CLI twice for an unchanged day does not create a duplicate commit', () => {
  const root = initFixture();
  execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
  const secondOutput = execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
  assert.match(secondOutput, /^NOOP /);

  const briefingsDir = path.join(root, 'docs', 'briefings');
  const jsonFile = fs.readdirSync(briefingsDir).find((f) => f.endsWith('.json'));
  assert.equal(commitCount(root, path.join('docs', 'briefings', jsonFile)), 1);
});

test('a missing .swarmforge/roles.tsv (no resolvable project root) exits non-zero rather than emitting nothing silently', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  assert.throws(() => execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
