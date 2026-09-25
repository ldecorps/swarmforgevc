const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ensureLifecycleSnapshot, main } = require('../out/tools/emit-lifecycle-snapshot');
const { lifecycleSnapshotPath, writeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');

const DAY1 = Date.parse('2026-08-15T09:00:00Z');
const DAY1_LATER = Date.parse('2026-08-15T18:00:00Z');
const DAY2 = Date.parse('2026-08-16T09:00:00Z');

function mkTmp() {
  return mkTmpDir('sfvc-emit-lifecycle-snapshot-');
}

function fakeGitLogEntries() {
  return [
    {
      commit: 'aaa',
      dateIso: '2026-08-01T00:00:00Z',
      changes: [{ status: 'A', path: 'backlog/paused/BL-1.yaml' }],
    },
  ];
}

// BL-897 briefing-gather-once-01: the countable acceptance signal - the
// injected runGitLogFn seam is what lets a test count/assert exactly one
// walk without a real git fixture repo.

test('with no existing snapshot, ensureLifecycleSnapshot walks exactly once and writes the file', () => {
  const dir = mkTmp();
  let calls = 0;
  const runGitLogFn = (targetPath, pathspec) => {
    calls += 1;
    assert.equal(targetPath, dir);
    assert.equal(pathspec, 'backlog');
    return fakeGitLogEntries();
  };

  const result = ensureLifecycleSnapshot(dir, DAY1, { runGitLogFn });

  assert.equal(calls, 1);
  assert.equal(result.walked, true);
  assert.equal(result.path, lifecycleSnapshotPath(dir));
  assert.ok(fs.existsSync(result.path));
  const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(written.dayKey, '2026-08-15');
  assert.deepEqual(written.records, [{ ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }]);
});

test('with a fresh (same-day) snapshot already present, ensureLifecycleSnapshot never walks again', () => {
  const dir = mkTmp();
  writeLifecycleSnapshot(dir, [{ ticketId: 'BL-9', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }], DAY1);

  let calls = 0;
  const runGitLogFn = () => {
    calls += 1;
    return fakeGitLogEntries();
  };
  const result = ensureLifecycleSnapshot(dir, DAY1_LATER, { runGitLogFn });

  assert.equal(calls, 0);
  assert.equal(result.walked, false);
  // Untouched - still the original BL-9 record, not overwritten.
  const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.deepEqual(written.records, [{ ticketId: 'BL-9', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }]);
});

test('a snapshot from a prior day is stale, so ensureLifecycleSnapshot walks again and refreshes it', () => {
  const dir = mkTmp();
  writeLifecycleSnapshot(dir, [{ ticketId: 'BL-9', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }], DAY1);

  let calls = 0;
  const runGitLogFn = () => {
    calls += 1;
    return fakeGitLogEntries();
  };
  const result = ensureLifecycleSnapshot(dir, DAY2, { runGitLogFn });

  assert.equal(calls, 1);
  assert.equal(result.walked, true);
  const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(written.dayKey, '2026-08-16');
  assert.deepEqual(written.records, [{ ticketId: 'BL-1', specDateIso: '2026-08-01T00:00:00Z', closeDateIso: null }]);
});

// ── main(): in-process smoke test against this repo's own real git history ──

// main() prints via printJsonToStdout (process.stdout.write directly, not
// console.log) - mirrors renderBriefingDiagramsCli.test.js's own identical
// seam.
async function runCli(cwd) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => cwd;
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  }
  return writes.join('');
}

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

// BL-1741: main() calls resolveProjectRoot(process.cwd()) unconditionally
// (no injected seam) and, via ensureLifecycleSnapshot's own default
// runGitLogFn, does a REAL git log walk - so this test needs a REAL git
// fixture, never the checkout the suite itself runs in (that made this
// file's own duration - and whether it walked at all - depend on which
// worktree ran it and what day it last held a snapshot, BL-1717's 16.1 s
// refusal). BL-1390: proven isolated (git-common-dir resolves inside the
// fixture root) before any further git write.
function mkFixtureCheckout() {
  const dir = mkTmp();
  git(dir, 'init', '-q', '-b', 'main');
  const commonDir = git(dir, 'rev-parse', '--git-common-dir').trim();
  assert.ok(
    path.resolve(dir, commonDir).startsWith(dir),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  // resolveProjectRoot requires .swarmforge/roles.tsv at the git root -
  // content is irrelevant, only presence is checked.
  fs.mkdirSync(path.join(dir, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarmforge', 'roles.tsv'), '');
  fs.mkdirSync(path.join(dir, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backlog', 'paused', 'BL-1.yaml'), 'id: BL-1\nstatus: todo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'BL-1: seed');
  return dir;
}

test('the compiled CLI runs against the real repo and prints a path/walked JSON result', async () => {
  const fixtureRoot = mkFixtureCheckout();
  const output = await runCli(fixtureRoot);
  const parsed = JSON.parse(output);
  assert.equal(typeof parsed.path, 'string');
  assert.equal(parsed.path, lifecycleSnapshotPath(fixtureRoot));
  assert.ok(parsed.path.includes(path.join('.swarmforge', 'briefing', 'lifecycle-snapshot.json')));
  // A brand-new fixture with no pre-existing snapshot always walks - unlike
  // the real worktree this used to run against, that is now deterministic.
  assert.equal(parsed.walked, true);
});
