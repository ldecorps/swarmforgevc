const { mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { renderBriefingBurndown, main } = require('../out/tools/render-briefing-burndown');
const { NOT_DONE_BURNDOWN_DIAGRAM_NAME } = require('../out/metrics/notDoneBurndownChart');
const { serializeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');

// BL-2031: none of the tests below reads THIS checkout's live repository.
// They used to point at this repo's own checkout and deriveTicketLifecycles
// (runGitLog(...)) walked its whole backlog/ history (12.6s, 14.1s, 7.0s).
// A small real git fixture, built once in beforeAll (BL-1770's pattern),
// gives the CLI a non-trivial merged ticket and a non-trivial blocked ticket,
// independent of this repo's own size or history.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOW_MS = Date.parse('2026-08-15T15:00:00Z');

// Ticket ids that could never appear in this real repo's own git history -
// if the resulting diagram reflects THIS data, the shared snapshot was
// used, not a live git derivation (render-briefing-burndown.ts has no
// injectable runGitLog seam, so this is the only way to prove which path
// ran without faking git itself).
const FAKE_RECORDS = [
  { ticketId: 'ZZ-90001', specDateIso: '2026-08-10T10:00:00Z', closeDateIso: null },
  { ticketId: 'ZZ-90002', specDateIso: '2026-08-11T10:00:00Z', closeDateIso: null },
];

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkFixtureCheckout() {
  const dir = mkSharedTmpDir('sfvc-render-burndown-fixture-');
  git(dir, 'init', '-q', '-b', 'main');
  const commonDir = git(dir, 'rev-parse', '--git-common-dir').trim();
  assert.ok(
    path.resolve(dir, commonDir).startsWith(dir),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');

  // resolveProjectRoot requires .swarmforge/roles.tsv at the git root.
  fs.mkdirSync(path.join(dir, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarmforge', 'roles.tsv'), `coder\tcoder\t${dir}\tswarmforge-coder\tCoder\tclaude\n`);

  // Merged: BL-9001 arrives active, then closes into done - both real
  // commits, so their timestamps are "now", safely inside any multi-day
  // "since last briefing" cutoff.
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

  return dir;
}

let FIXTURE_ROOT;

beforeAll(() => {
  FIXTURE_ROOT = mkFixtureCheckout();
});

function writeFixtureSnapshot(dir, records, nowMs) {
  const filePath = path.join(dir, 'snapshot.json');
  fs.writeFileSync(filePath, JSON.stringify(serializeLifecycleSnapshot(records, nowMs), null, 2), 'utf8');
  return filePath;
}

test('renderBriefingBurndown uses the shared snapshot records when a fresh one is given, never deriving its own', () => {
  const dir = mkTmpDir('sfvc-render-burndown-');
  const snapshotPath = writeFixtureSnapshot(dir, FAKE_RECORDS, NOW_MS);

  const diagrams = renderBriefingBurndown(dir, NOW_MS, snapshotPath);

  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
  const png = Buffer.from(diagrams[0].base64, 'base64');
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
});

// BL-2031: these two tests now run against the fixture checkout (a small
// real git repo with a merged ticket), not this checkout's live history.
// They still assert the same code path (the fallback derivation), but the
// fixture's two-commit backlog history makes them fast and independent of
// this repo's size.
test(
  'renderBriefingBurndown falls back to deriving its own history when no snapshot path is given',
  () => {
    const diagrams = renderBriefingBurndown(FIXTURE_ROOT);
    assert.equal(diagrams.length, 1);
    assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
  }
);

test(
  'renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist',
  () => {
    const diagrams = renderBriefingBurndown(FIXTURE_ROOT, Date.now(), '/no/such/snapshot.json');
    assert.equal(diagrams.length, 1);
  }
);

// ── main(): argv parsing + stdout plumbing ───────────────────────────────

async function runCli(cwd, argv) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => cwd;
    process.argv = ['node', 'render-briefing-burndown.js', ...argv];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return JSON.parse(writes.join(''));
}

test('the compiled CLI reads --snapshot from argv and reflects the shared snapshot data', async () => {
  // cwd must resolve to a real project root (.swarmforge/roles.tsv) for
  // resolveProjectRoot to succeed - the snapshot path itself is unrelated
  // to that root, so it can still point at an arbitrary fixture file.
  const dir = mkTmpDir('sfvc-render-burndown-');
  const snapshotPath = writeFixtureSnapshot(dir, FAKE_RECORDS, Date.now());

  const diagrams = await runCli(FIXTURE_ROOT, ['--snapshot', snapshotPath]);

  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
});

// BL-2031: no --snapshot flag means the FULL derive (runGitLog/
// deriveTicketLifecycles) plus a real PNG render - same path as the two
// fallback tests above, now against the fixture repo instead of the live
// checkout. The fixture's two-commit backlog history makes this fast.
test(
  'the compiled CLI runs with no flags at all',
  async () => {
    const diagrams = await runCli(FIXTURE_ROOT, []);
    assert.equal(diagrams.length, 1);
    assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
  }
);
