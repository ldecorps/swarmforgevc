const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatEmitResult, main } = require('../out/tools/emit-cost-health-sidecar');

// ── formatEmitResult ─────────────────────────────────────────────────────

test('formatEmitResult reports EMITTED when a commit was made', () => {
  assert.equal(formatEmitResult(true, 'docs/briefings/2026-07-11.json'), 'EMITTED docs/briefings/2026-07-11.json');
});

test('formatEmitResult reports NOOP when the sidecar was unchanged', () => {
  assert.equal(formatEmitResult(false, 'docs/briefings/2026-07-11.json'), 'NOOP docs/briefings/2026-07-11.json');
});

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

function runCliSubprocess(root) {
  return execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
}

// Runs the REAL main() in-process against a real fixture repo, so in-process
// coverage and mutation tooling can see the branches a subprocess-only smoke
// test cannot (mirrors notifyDeadLettersCli.test.js's own identical seam).
// main() takes no arguments and reads process.cwd() internally (via
// resolveCliMainWorktreeContext). Unlike notify-dead-letters.js (which
// prints via printJsonToStdout/process.stdout.write), this CLI prints via
// console.log - under Vitest, console.log is NOT routed through
// process.stdout.write (Vitest intercepts console itself), so console.log
// must be mocked directly here to observe the output.
async function runCli(root) {
  const previousCwd = process.cwd();
  const writes = [];
  const originalLog = console.log;
  console.log = (chunk) => {
    writes.push(chunk);
  };
  try {
    process.chdir(root);
    await main();
  } finally {
    console.log = originalLog;
    process.chdir(previousCwd);
  }
  return writes.join('\n') + (writes.length > 0 ? '\n' : '');
}

// BL-290 suite-duration-pwa-01: the same emit path also carries the
// suite-duration trend - no .test-durations.jsonl exists in this fixture,
// so hasLocalData must be a real, honest false, never fabricated.
test("the compiled CLI's emitted sidecar carries the suite-duration trend", async () => {
  const root = initFixture();
  await runCli(root);

  const briefingsDir = path.join(root, 'docs', 'briefings');
  const jsonFile = fs.readdirSync(briefingsDir).find((f) => f.endsWith('.json'));
  const sidecar = JSON.parse(fs.readFileSync(path.join(briefingsDir, jsonFile), 'utf8'));

  assert.ok(sidecar.suiteDurationTrend, 'expected the sidecar to carry a suiteDurationTrend field');
  assert.equal(sidecar.suiteDurationTrend.hasLocalData, false);
});

// BL-272 headless-cost-health-sidecar-03: re-running against an unchanged
// day makes no duplicate commit - commitCostHealthSidecar's existing
// fails-closed `git commit` no-op, exercised end-to-end through main().
test('running the CLI twice for an unchanged day does not create a duplicate commit', async () => {
  const root = initFixture();
  await runCli(root);
  const secondOutput = await runCli(root);
  assert.match(secondOutput, /^NOOP /);

  const briefingsDir = path.join(root, 'docs', 'briefings');
  const jsonFile = fs.readdirSync(briefingsDir).find((f) => f.endsWith('.json'));
  assert.equal(commitCount(root, path.join('docs', 'briefings', jsonFile)), 1);
});

test('a missing .swarmforge/roles.tsv (no resolvable project root) exits non-zero rather than emitting nothing silently', async () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  await assert.rejects(() => runCli(root));
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
// BL-272 headless-cost-health-sidecar-01: the compiled CLI runs the SAME
// compute -> write -> commit path extension.ts's onBriefingDue calls
// in-process, with no VS Code host - it emits and commits today's sidecar.
test("the compiled CLI runs standalone as a subprocess and emits/commits today's cost & health sidecar", () => {
  const root = initFixture();
  const output = runCliSubprocess(root);
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
