const { mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sinceLastBriefingMs, formatMergedBlockedDigest, main } = require('../out/tools/briefing-digest-line');
const { serializeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'briefing-digest-line.js');

function mkTmp() {
  return mkTmpDir('briefing-digest-test-');
}

// ── sinceLastBriefingMs ─────────────────────────────────────────────────

test('with two or more briefings, the cutoff is the second-most-recent one (today\'s own file is excluded)', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, '2026-07-08.md'), 'old\n');
  fs.writeFileSync(path.join(dir, '2026-07-09.md'), 'yesterday\n');
  fs.writeFileSync(path.join(dir, '2026-07-10.md'), 'today, about to be sent\n');

  const cutoffMs = sinceLastBriefingMs(dir, Date.parse('2026-07-10T20:00:00Z'));

  assert.equal(cutoffMs, Date.parse('2026-07-09T00:00:00Z'));
});

test('with fewer than two briefings, falls back to a 24h window, not a crash', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, '2026-07-10.md'), 'only today\n');
  const nowMs = Date.parse('2026-07-10T20:00:00Z');

  assert.equal(sinceLastBriefingMs(dir, nowMs), nowMs - 24 * 60 * 60 * 1000);
});

test('an absent briefings directory falls back to a 24h window, not a crash', () => {
  const nowMs = Date.parse('2026-07-10T20:00:00Z');
  assert.equal(sinceLastBriefingMs(path.join(mkTmp(), 'nonexistent'), nowMs), nowMs - 24 * 60 * 60 * 1000);
});

test('a second-most-recent filename that is not a parseable date falls back to a 24h window, not NaN', () => {
  const dir = mkTmp();
  // "9999-99-99" sorts before "zzz-not-a-date" alphabetically, landing it in
  // the second-most-recent slot Date.parse can't turn into a real instant.
  fs.writeFileSync(path.join(dir, '9999-99-99.md'), 'malformed\n');
  fs.writeFileSync(path.join(dir, 'zzz-not-a-date.md'), 'also not a date\n');
  const nowMs = Date.parse('2026-07-10T20:00:00Z');

  assert.equal(sinceLastBriefingMs(dir, nowMs), nowMs - 24 * 60 * 60 * 1000);
});

// ── formatMergedBlockedDigest ────────────────────────────────────────────
// graceful-missing-data-05

test('formats merged and blocked lines, with deep links when a builder returns one', () => {
  const merged = [{ ticketId: 'BL-1', closeDateIso: '2026-07-09T10:00:00Z' }];
  const blocked = [{ ticketId: 'BL-2', role: 'coder', openMs: 13 * 60 * 60 * 1000 }];

  const text = formatMergedBlockedDigest(merged, blocked, (id) => `https://example.io/#ticket=${id}`);

  assert.match(text, /Merged since last briefing: BL-1 \(https:\/\/example\.io\/#ticket=BL-1\)/);
  assert.match(text, /Blocked\/stalled: BL-2 \(https:\/\/example\.io\/#ticket=BL-2\) \(coder, open 13h/);
});

test('omits the link parens when no deep link is available', () => {
  const merged = [{ ticketId: 'BL-1', closeDateIso: '2026-07-09T10:00:00Z' }];
  const text = formatMergedBlockedDigest(merged, [], () => null);
  assert.match(text, /Merged since last briefing: BL-1$/m);
});

test('an empty merged list shows an explicit "none" note, not a blank line', () => {
  const text = formatMergedBlockedDigest([], [], () => null);
  assert.match(text, /Merged since last briefing: none\./);
});

test('an empty blocked list shows an explicit "none" note, not a blank line', () => {
  const text = formatMergedBlockedDigest([], [], () => null);
  assert.match(text, /Blocked\/stalled: none\./);
});

// ── end-to-end: the compiled CLI's own real output, against a fixture repo ──
//
// BL-1770: none of the tests below reads THIS checkout's live repository.
// They used to point the CLI's cwd at this repo's own checkout, and
// deriveTicketLifecycles(runGitLog(...)) then walked its whole `backlog/`
// history: 11.5s/10.5s/8.8s per run at load 15, and the same walks made
// this file a 36.3s suite-duration pole (BL-791 slice D). A small real git
// fixture, built once in beforeAll (BL-1390: proven isolated - its
// git-common-dir resolves inside the fixture root - before any mutating
// git command), gives the CLI a non-trivial merged ticket (a backlog
// ticket file arriving under backlog/done/ inside the digest's "since"
// window) and a non-trivial blocked ticket (an open in_process holding
// window past the 12h threshold), independent of this repo's own size or
// history.

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkFixtureCheckout() {
  const dir = mkSharedTmpDir('briefing-digest-cli-fixture-');
  git(dir, 'init', '-q', '-b', 'main');
  const commonDir = git(dir, 'rev-parse', '--git-common-dir').trim();
  assert.ok(
    path.resolve(dir, commonDir).startsWith(dir),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');

  // resolveProjectRoot requires .swarmforge/roles.tsv at the git root; a
  // real "coder" row (worktreePath = the fixture root itself) is what
  // gives readRoleHoldingWindows below a directory to find the blocked
  // ticket's open handoff in.
  fs.mkdirSync(path.join(dir, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${dir}\tswarmforge-coder\tCoder\tclaude\n`);

  // Merged: BL-9001 arrives active, then closes into done - both real
  // commits, so their timestamps are "now", safely inside any multi-day
  // "since last briefing" cutoff set up below.
  fs.mkdirSync(path.join(dir, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog', 'active', 'BL-9001-fixture.yaml'), 'id: BL-9001\nstatus: todo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'BL-9001: seed');

  fs.mkdirSync(path.join(dir, 'backlog', 'done'), { recursive: true });
  fs.renameSync(
    path.join(dir, 'backlog', 'active', 'BL-9001-fixture.yaml'),
    path.join(dir, 'backlog', 'done', 'BL-9001-fixture.yaml')
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'BL-9001: close');

  // Two briefings, both a few days old, so the digest's cutoff (the
  // second-most-recent filename) sits safely before the close commit above.
  const olderDay = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newerDay = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  fs.mkdirSync(path.join(dir, 'docs', 'briefings'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'briefings', `${olderDay}.md`), 'old\n');
  fs.writeFileSync(path.join(dir, 'docs', 'briefings', `${newerDay}.md`), 'newer\n');

  // Blocked: BL-9002 has an open (no completed_at) in_process holding
  // window, started well past the 12h threshold.
  const inProcessDir = path.join(dir, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  const dequeuedAt = new Date(Date.now() - 15 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(inProcessDir, '00_fixture_BL-9002.handoff'), `task: BL-9002\ndequeued_at: ${dequeuedAt}\n\npayload\n`);

  return dir;
}

let FIXTURE_ROOT;

beforeAll(() => {
  FIXTURE_ROOT = mkFixtureCheckout();
});

function runCliSubprocess(cwd) {
  return execFileSync('node', [CLI], { cwd, encoding: 'utf8' });
}

// Runs the REAL main() in-process against the fixture repo, so in-process
// coverage and mutation tooling can see the branches a subprocess-only
// smoke test cannot (the CLI main()-thin-wrapper rule; mirrors
// notifyDeadLettersCli.test.js's own identical seam). main() prints via
// console.log (not process.stdout.write directly), and Vitest's own console
// interception (globals: true) rewrites console.log independently of
// process.stdout - so console.log itself is overridden here to capture the
// digest text.
async function runCli(cwd, argv = []) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.cwd = () => cwd;
    process.argv = ['node', 'briefing-digest-line.js', ...argv];
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return writes.join('\n') + '\n';
}

test('the compiled CLI runs against a fixture repo and prints both lines', async () => {
  const output = await runCli(FIXTURE_ROOT);
  assert.match(output, /Merged since last briefing: BL-9001/);
  assert.match(output, /Blocked\/stalled: BL-9002 \(coder, open \d+h/);
});

// BL-897: with --snapshot given and usable, the merged-since digest
// reflects the SHARED snapshot's records, not a fresh runGitLog walk - a
// ticket id that could never appear in the fixture's own git history
// proves which source won.
test('the compiled CLI uses a shared --snapshot for the merged line when one is given', async () => {
  const nowMs = Date.now();
  const snapshotDir = mkTmp();
  const snapshotPath = path.join(snapshotDir, 'snapshot.json');
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      serializeLifecycleSnapshot(
        [{ ticketId: 'ZZ-90003', specDateIso: new Date(nowMs - 60 * 60 * 1000).toISOString(), closeDateIso: new Date(nowMs - 30 * 60 * 1000).toISOString() }],
        nowMs
      ),
      null,
      2
    ),
    'utf8'
  );

  const output = await runCli(FIXTURE_ROOT, ['--snapshot', snapshotPath]);

  assert.match(output, /Merged since last briefing: ZZ-90003/);
});

test('the compiled CLI falls back to deriving its own history when --snapshot points at a nonexistent file', async () => {
  const output = await runCli(FIXTURE_ROOT, ['--snapshot', '/no/such/snapshot.json']);
  // Named ticket ids, not just the label prefix: a generic "some non-empty
  // line" match would pass even if the fallback silently returned an empty
  // derivation - only BL-9001/BL-9002 prove the walk actually re-derived
  // from the fixture's own git/handoff history, the same way the sibling
  // --snapshot test above proves ZZ-90003 came from the snapshot and not
  // a fixture walk.
  assert.match(output, /Merged since last briefing: BL-9001/);
  assert.match(output, /Blocked\/stalled: BL-9002 \(coder, open \d+h/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/cwd boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const output = runCliSubprocess(FIXTURE_ROOT);
  assert.match(output, /^Merged since last briefing: /);
  assert.match(output, /Blocked\/stalled: /);
});
