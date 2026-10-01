const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatSuboptimalityVerdictLine, main } = require('../out/tools/suboptimality-verdict-line');
const { persistReworkSignal, observatorySignalsPath, readReworkSignal } = require('../out/metrics/reworkObservatoryStore');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'suboptimality-verdict-line.js');

function mkTmp() {
  return mkTmpDir('sfvc-suboptimality-cli-');
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mkCliFixture() {
  const repo = mkTmp();
  copySeededRepoInto(repo);
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

test('main() prints nothing when the fresh observatory has no sample, never a crash', async () => {
  const repo = mkCliFixture();
  const output = await runCli(repo);
  assert.equal(output, '');
});

// Regression: a July-era 22%-style snapshot must not keep alarming once the
// live window has nothing to sample - the CLI refreshes before diagnosing.
test('main() clears a stale above-baseline snapshot instead of echoing it forever', async () => {
  const repo = mkCliFixture();
  persistReworkSignal(repo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:22:02.557Z',
    signal: {
      hasSample: true,
      sampleCount: 303,
      reworkRate: 0.21782178217821782,
      baselineRate: 0,
      topRole: 'QA',
      topTicketClass: 'medium',
    },
  });
  const output = await runCli(repo);
  assert.equal(output, '');
  const refreshed = JSON.parse(fs.readFileSync(observatorySignalsPath(repo), 'utf8'));
  const entry = refreshed.signals.find((s) => s.kind === 'rework-rate');
  assert.notEqual(entry.computedAtIso, '2026-07-16T00:22:02.557Z');
  assert.equal(entry.signal.hasSample, false);
});

test('main() prints the verdict line when the live observatory is meaningfully above baseline', async () => {
  const repo = mkCliFixture();
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Baseline window (14-28d ago): one clean close → baselineRate 0.
  // Current window (within 14d): one bounced close → reworkRate 1 (> 2x 0).
  const baselineCloseIso = new Date(nowMs - 20 * DAY_MS).toISOString();
  const windowPromoteIso = new Date(nowMs - 5 * DAY_MS).toISOString();
  const windowCloseIso = new Date(nowMs - 4 * DAY_MS).toISOString();

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-9001.yaml'), 'id: BL-9001\nmutation_cost: low\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote baseline'], baselineCloseIso);
  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-9001.yaml', 'backlog/done/BL-9001.yaml']);
  git(repo, ['commit', '-q', '-m', 'close baseline'], baselineCloseIso);

  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-9002.yaml'), 'id: BL-9002\nmutation_cost: medium\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote hot'], windowPromoteIso);
  git(repo, ['mv', 'backlog/active/BL-9002.yaml', 'backlog/done/BL-9002.yaml']);
  mkdirp(path.join(repo, 'backlog', 'evidence'));
  fs.writeFileSync(path.join(repo, 'backlog', 'evidence', 'BL-9002-qa-bounce.md'), 'bounce\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'close hot with bounce evidence'], windowCloseIso);

  const output = await runCli(repo);
  assert.match(output, /^Suboptimality verdict: /);
  assert.match(output, /ticket-class medium/);
  const signal = readReworkSignal(repo);
  assert.ok(signal);
  assert.equal(signal.reworkRate, 1);
  assert.equal(signal.baselineRate, 0);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/cwd boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and refreshes rather than echoing a stale alarm', () => {
  const repo = mkCliFixture();
  persistReworkSignal(repo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:22:02.557Z',
    signal: {
      hasSample: true,
      sampleCount: 303,
      reworkRate: 0.21782178217821782,
      baselineRate: 0,
      topRole: 'QA',
      topTicketClass: 'medium',
    },
  });
  const output = execFileSync('node', [CLI], { cwd: repo, encoding: 'utf8' });
  assert.equal(output, '');
});
