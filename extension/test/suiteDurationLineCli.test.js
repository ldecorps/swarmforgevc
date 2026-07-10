const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-252: the compiled suite-duration-line CLI is what briefing_email_lib.bb
// shells out to (Babashka cannot import compiled TS) - reuses
// computeSuiteDurationTrend + formatSuiteDurationTrendLine unchanged, the
// SAME functions already wired into the bridge's /metrics route, so the
// briefing can never disagree with the holistic UI about what "regressing"
// means.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-suite-duration-line-cli-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRolesTsv(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
}

function writeDurationRecords(root, lines) {
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'extension', '.test-durations.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  );
}

test('the compiled CLI prints "no local data" when no duration records exist', () => {
  const root = mkTmp();
  writeRolesTsv(root);

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'suite-duration-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' }).trim();

  assert.equal(output, 'Suite duration trend: no local data');
});

test('the compiled CLI prints the latest duration and trend direction with no WARN prefix when under the creep threshold', () => {
  const root = mkTmp();
  writeRolesTsv(root);
  writeDurationRecords(root, [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1200 },
  ]);

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'suite-duration-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' }).trim();

  assert.match(output, /^Suite duration trend: 1s latest/);
  assert.doesNotMatch(output, /^WARN/);
});

test('the compiled CLI prints a WARN prefix when the latest run trips the SAME BL-078 creep-warning signal the holistic UI reads', () => {
  const root = mkTmp();
  writeRolesTsv(root);
  writeDurationRecords(root, [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 5000 },
  ]);

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'suite-duration-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' }).trim();

  assert.match(output, /^WARN Suite duration trend:/);
});
