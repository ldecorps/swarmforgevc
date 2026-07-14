const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/suite-duration-line');

// BL-252: the compiled suite-duration-line CLI is what briefing_email_lib.bb
// shells out to (Babashka cannot import compiled TS) - reuses
// computeSuiteDurationTrend + formatSuiteDurationTrendLine unchanged, the
// SAME functions already wired into the bridge's /metrics route, so the
// briefing can never disagree with the holistic UI about what "regressing"
// means.

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'suite-duration-line.js');

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

function runCliSubprocess(root) {
  return execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' }).trim();
}

// Runs the REAL main() in-process against a real fixture repo, so in-process
// coverage and mutation tooling can see this CLI's own logic (the
// engineering article's CLI main()-thin-wrapper rule). main() prints via
// console.log (NOT process.stdout.write) - under Vitest console.log does not
// route through process.stdout.write, so console.log itself must be
// intercepted or the mock silently captures nothing.
function runCli(root) {
  const originalCwd = process.cwd;
  const chunks = [];
  const originalLog = console.log;
  console.log = (...args) => {
    chunks.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    process.cwd = () => root;
    main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }
  return chunks.join('\n').trim();
}

test('main() prints "no local data" when no duration records exist', () => {
  const root = mkTmp();
  writeRolesTsv(root);

  const output = runCli(root);

  assert.equal(output, 'Suite duration trend: no local data');
});

test('main() prints the latest duration and trend direction with no WARN prefix when under the creep threshold', () => {
  const root = mkTmp();
  writeRolesTsv(root);
  writeDurationRecords(root, [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1200 },
  ]);

  const output = runCli(root);

  assert.match(output, /^Suite duration trend: 1s latest/);
  assert.doesNotMatch(output, /^WARN/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result: WARN prefix when the latest run trips the SAME BL-078 creep-warning signal the holistic UI reads', () => {
  const root = mkTmp();
  writeRolesTsv(root);
  writeDurationRecords(root, [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 5000 },
  ]);

  const output = runCliSubprocess(root);

  assert.match(output, /^WARN Suite duration trend:/);
});
