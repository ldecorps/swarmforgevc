'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseArgs,
  resolveRepoRoot,
  readAcceptanceDeclaration,
  runAcceptance,
  moveTicketToDone,
  writeReceipt,
  getLandedCommit,
  main,
} = require('../out/tools/pilot-acceptance-gate');

function mkRepo(prefix) {
  return mkTmpDir(prefix || 'sfvc-pag-cli-');
}

function initGitRepo(root, { commit = true } = {}) {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  if (commit) {
    fs.writeFileSync(path.join(root, 'README.md'), 'x', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  }
}

function writeTicketYaml(root, ticketId, extraFields) {
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const body = [`id: ${ticketId}`, 'title: "fixture"', ...(extraFields || [])].join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${ticketId}-fixture.yaml`), body, 'utf8');
}

// ── parseArgs ──────────────────────────────────────────────────────────

test('parseArgs returns the ticket id when given', () => {
  assert.deepEqual(parseArgs(['BL-727']), { ticketId: 'BL-727' });
});

test('parseArgs returns null when no argument is given', () => {
  assert.equal(parseArgs([]), null);
});

// ── resolveRepoRoot: real git wiring, including the failure path ────────

test('resolveRepoRoot resolves the real git top-level for a subdirectory cwd', () => {
  const root = mkRepo();
  initGitRepo(root);
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub);
  assert.equal(fs.realpathSync(resolveRepoRoot(sub)), fs.realpathSync(root));
});

test('resolveRepoRoot throws (fails loud, never silently defaults) outside any git repo', () => {
  const root = mkRepo();
  assert.throws(() => resolveRepoRoot(root));
});

// ── readAcceptanceDeclaration: real disk read, and the absent-ticket path ─

test('readAcceptanceDeclaration reads the real acceptance field from the backlog yaml on disk', () => {
  const root = mkRepo();
  writeTicketYaml(root, 'BL-FIX', ['acceptance: specs/features/fixture.feature']);
  assert.equal(readAcceptanceDeclaration(root, 'BL-FIX'), 'specs/features/fixture.feature');
});

test('readAcceptanceDeclaration returns undefined (not a throw) when the ticket file does not exist', () => {
  const root = mkRepo();
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  assert.equal(readAcceptanceDeclaration(root, 'BL-NOPE'), undefined);
});

test('readAcceptanceDeclaration returns undefined when the ticket carries no acceptance field at all', () => {
  const root = mkRepo();
  writeTicketYaml(root, 'BL-FIX', []);
  assert.equal(readAcceptanceDeclaration(root, 'BL-FIX'), undefined);
});

// ── moveTicketToDone: real fs move ───────────────────────────────────────

test('moveTicketToDone physically moves the yaml from backlog/active to backlog/done', () => {
  const root = mkRepo();
  writeTicketYaml(root, 'BL-FIX', []);
  const src = path.join(root, 'backlog', 'active', 'BL-FIX-fixture.yaml');

  const result = moveTicketToDone(root, 'BL-FIX');

  assert.equal(result.moved, true);
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.existsSync(result.destination), true);
});

// ── writeReceipt: real disk write ────────────────────────────────────────

test('writeReceipt writes the receipt under .swarmforge/expedite/<ticket>/acceptance-receipt.json', () => {
  const root = mkRepo();
  const receipt = {
    ticketId: 'BL-FIX',
    featureFile: 'specs/features/fixture.feature',
    landedCommit: 'a'.repeat(40),
    result: 'passed',
    landedAt: '2026-07-31T00:00:00.000Z',
  };

  writeReceipt(root, 'BL-FIX', receipt);

  const written = JSON.parse(
    fs.readFileSync(path.join(root, '.swarmforge', 'expedite', 'BL-FIX', 'acceptance-receipt.json'), 'utf8')
  );
  assert.deepEqual(written, receipt);
});

// ── getLandedCommit: real git wiring, including the failure path ────────

test('getLandedCommit returns the real HEAD sha for the given repo', () => {
  const root = mkRepo();
  initGitRepo(root);
  const sha = getLandedCommit(root);
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(sha, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
});

test('getLandedCommit throws (fails loud) when the repo has no commit yet', () => {
  const root = mkRepo();
  initGitRepo(root, { commit: false });
  assert.throws(() => getLandedCommit(root));
});

// ── runAcceptance: real dynamic require of specs/pipeline/runnerAdapter.js
// under the given repoRoot - proves the wiring is live (repoRoot-derived,
// not a hardcoded path to THIS project's own pipeline), and drives its own
// CLI-failure path (module missing) - not only the happy path.

test('runAcceptance requires runnerAdapter.js from the given repoRoot and forwards the right paths', async () => {
  const root = mkRepo();
  const pipelineDir = path.join(root, 'specs', 'pipeline');
  fs.mkdirSync(pipelineDir, { recursive: true });
  const callsFile = path.join(root, 'calls.json');
  fs.writeFileSync(
    path.join(pipelineDir, 'runnerAdapter.js'),
    [
      "const fs = require('fs');",
      'module.exports = {',
      '  runPipeline: (featureFilePath, outDir, stepsModulePath) => {',
      `    fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ featureFilePath, outDir, stepsModulePath }));`,
      "    return Promise.resolve({ success: true, output: 'stub-ok' });",
      '  },',
      '};',
    ].join('\n'),
    'utf8'
  );
  const featureFilePath = path.join(root, 'specs', 'features', 'fixture.feature');

  const result = await runAcceptance(root, featureFilePath);

  assert.deepEqual(result, { success: true, output: 'stub-ok' });
  const recorded = JSON.parse(fs.readFileSync(callsFile, 'utf8'));
  assert.equal(recorded.featureFilePath, featureFilePath);
  assert.equal(recorded.outDir, path.join(pipelineDir, 'generated'));
  assert.equal(recorded.stepsModulePath, path.join(pipelineDir, 'steps', 'index.js'));
});

test('runAcceptance throws (fails loud) when the target repo has no specs/pipeline/runnerAdapter.js', async () => {
  const root = mkRepo();
  await assert.rejects(() => runAcceptance(root, path.join(root, 'specs', 'features', 'fixture.feature')));
});

// ── the CLI's own main(), run in-process (argv/cwd injected, stdout captured) ─

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'pilot-acceptance-gate.js');

// Same pattern as onboardingContractGateCli.test.js: stub process.argv /
// process.cwd / process.stdout.write (never process.chdir()) so the real
// main() runs in-process where coverage/mutation tooling can see it, and
// always restore in `finally` since Vitest runs the whole file in one
// worker process.
async function runCli(argv, cwd) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...argv];
    process.exitCode = undefined;
    if (cwd) {
      process.cwd = () => cwd;
    }
    await main();
    const exitCode = process.exitCode;
    const raw = writes.join('');
    return { exitCode, output: raw ? JSON.parse(raw) : null };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    process.cwd = previousCwd;
  }
}

test('main(): prints usage and exits non-zero when no ticket id is given', async () => {
  const { exitCode, output } = await runCli([]);
  assert.equal(exitCode, 1);
  assert.equal(output, null);
});

test('main(): refuses in-process for a ticket with no executable acceptance contract, and writes nothing to disk', async () => {
  const root = mkRepo();
  initGitRepo(root);
  writeTicketYaml(root, 'BL-FIX', []);

  const { exitCode, output } = await runCli(['BL-FIX'], root);

  assert.equal(exitCode, 1);
  assert.equal(output.landed, false);
  assert.equal(output.reasonKind, 'no-contract');
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'active', 'BL-FIX-fixture.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'expedite', 'BL-FIX')), false);
});

test('main(): lands in-process on a green run, moving the yaml and writing a receipt', async () => {
  const root = mkRepo();
  initGitRepo(root);
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'fixture.feature'), 'Feature: fixture\n', 'utf8');
  fs.mkdirSync(path.join(root, 'specs', 'pipeline'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'specs', 'pipeline', 'runnerAdapter.js'),
    "module.exports = { runPipeline: () => Promise.resolve({ success: true, output: 'ok' }) };",
    'utf8'
  );
  writeTicketYaml(root, 'BL-FIX', ['acceptance: specs/features/fixture.feature']);

  const { exitCode, output } = await runCli(['BL-FIX'], root);

  assert.equal(exitCode, undefined);
  assert.equal(output.landed, true);
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'active', 'BL-FIX-fixture.yaml')), false);
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'done', 'BL-FIX-fixture.yaml')), true);
  const receipt = JSON.parse(
    fs.readFileSync(path.join(root, '.swarmforge', 'expedite', 'BL-FIX', 'acceptance-receipt.json'), 'utf8')
  );
  assert.equal(receipt.featureFile, 'specs/features/fixture.feature');
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.landedCommit, output.receipt.landedCommit);
});

test('main(): a git wiring failure (no HEAD yet) crashes loudly instead of silently landing', async () => {
  const root = mkRepo();
  initGitRepo(root, { commit: false });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'fixture.feature'), 'Feature: fixture\n', 'utf8');
  fs.mkdirSync(path.join(root, 'specs', 'pipeline'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'specs', 'pipeline', 'runnerAdapter.js'),
    "module.exports = { runPipeline: () => Promise.resolve({ success: true, output: 'ok' }) };",
    'utf8'
  );
  writeTicketYaml(root, 'BL-FIX', ['acceptance: specs/features/fixture.feature']);

  await assert.rejects(() => runCli(['BL-FIX'], root));
  // Nothing moved and nothing written - the crash happened before either.
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'active', 'BL-FIX-fixture.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'done')), false);
});

// ── a real subprocess smoke test locks the compiled CLI's own entrypoint
// wiring (require.main === module, real argv/exit-code boundary) - an
// ADDITION to the in-process tests above, never the only cover.

function runCliSubprocess(argv, cwd) {
  return execFileSync('node', [CLI_PATH, ...argv], { cwd, encoding: 'utf8' });
}

test('the compiled CLI runs standalone as a subprocess and refuses with exit 1 for a contract-less ticket', () => {
  const root = mkRepo();
  initGitRepo(root);
  writeTicketYaml(root, 'BL-FIX', []);

  let stdout;
  try {
    stdout = runCliSubprocess(['BL-FIX'], root);
    assert.fail('expected the subprocess to exit non-zero on refusal');
  } catch (err) {
    assert.equal(err.status, 1);
    stdout = err.stdout;
  }
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.landed, false);
  assert.equal(parsed.reasonKind, 'no-contract');
});

test('the compiled CLI exits non-zero with no JSON on stdout when git itself fails (no commit yet)', () => {
  const root = mkRepo();
  initGitRepo(root, { commit: false });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'fixture.feature'), 'Feature: fixture\n', 'utf8');
  fs.mkdirSync(path.join(root, 'specs', 'pipeline'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'specs', 'pipeline', 'runnerAdapter.js'),
    "module.exports = { runPipeline: () => Promise.resolve({ success: true, output: 'ok' }) };",
    'utf8'
  );
  writeTicketYaml(root, 'BL-FIX', ['acceptance: specs/features/fixture.feature']);

  assert.throws(() => runCliSubprocess(['BL-FIX'], root));
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'done')), false);
});
