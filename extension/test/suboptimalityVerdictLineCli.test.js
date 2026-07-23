const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatSuboptimalityVerdictLine, main } = require('../out/tools/suboptimality-verdict-line');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'suboptimality-verdict-line.js');

function mkTmp() {
  return mkTmpDir('sfvc-suboptimality-cli-');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkCliFixture() {
  const repo = mkTmp();
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(repo, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${repo}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  return repo;
}

// ── formatSuboptimalityVerdictLine (pure) ──────────────────────────────────

test('formats the rate, baseline, likely cause, and classified recommendation', () => {
  const line = formatSuboptimalityVerdictLine({
    reworkRate: 0.5,
    baselineRate: 0.2,
    topRole: 'coder',
    topTicketClass: 'feature',
    likelyCause: 'role coder, ticket-class feature',
    recommendedAction: 'investigate role coder, ticket-class feature',
    disposition: 'escalate-only',
  });
  assert.match(line, /50%/);
  assert.match(line, /20%/);
  assert.match(line, /role coder, ticket-class feature/);
  assert.match(line, /\[escalate-only\]/);
});

// ── main() - real fixture, in-process (thin-wrapper rule) ──────────────────

async function runCli(root) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (chunk) => {
    writes.push(chunk);
  };
  try {
    process.argv = ['node', 'suboptimality-verdict-line.js'];
    process.cwd = () => root;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.join('\n');
}

test('main() prints nothing when no signal has been persisted yet, never a crash', async () => {
  const repo = mkCliFixture();
  const output = await runCli(repo);
  assert.equal(output, '');
});

test('main() prints nothing when the persisted signal is at/below baseline (no false alarm)', async () => {
  const repo = mkCliFixture();
  persistReworkSignal(repo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.1, baselineRate: 0.2, topRole: null, topTicketClass: null },
  });
  const output = await runCli(repo);
  assert.equal(output, '');
});

test('main() prints the verdict line when the persisted signal is meaningfully above baseline', async () => {
  const repo = mkCliFixture();
  persistReworkSignal(repo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.6, baselineRate: 0.2, topRole: 'hardener', topTicketClass: null },
  });
  const output = await runCli(repo);
  assert.match(output, /^Suboptimality verdict: /);
  assert.match(output, /hardener/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/cwd boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const repo = mkCliFixture();
  persistReworkSignal(repo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 5, reworkRate: 0.6, baselineRate: 0.2, topRole: 'hardener', topTicketClass: null },
  });
  const output = execFileSync('node', [CLI], { cwd: repo, encoding: 'utf8' });
  assert.match(output, /^Suboptimality verdict: /);
});
