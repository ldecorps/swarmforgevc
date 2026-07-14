const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-dashboard-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// BL-097 dashboard-01/02/05: the compiled generator prints ONLY valid JSON
// to stdout (so the Action can redirect straight to backlog.json), with a
// schema_version and no NaN/Infinity/undefined leaking through, matching
// swarmMetricsCli.test.js's own end-to-end convention.
test('the compiled generator prints a valid, schema-versioned backlog.json to stdout', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'generate-backlog-dashboard.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.doesNotMatch(output, /NaN|Infinity|undefined/);
  const data = JSON.parse(output);
  assert.equal(typeof data.schemaVersion, 'number');
  assert.ok(data.generatedAtIso);
  assert.ok(data.sourceSha);
  assert.deepEqual(data.board.active, []);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'suiteDurationTrend'), false);
});
