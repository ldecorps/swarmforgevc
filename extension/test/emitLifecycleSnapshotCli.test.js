const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('the compiled CLI runs against the real repo and prints a path/walked JSON result', async () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const writtenPath = lifecycleSnapshotPath(repoRoot);
  const preexisted = fs.existsSync(writtenPath);
  const priorContent = preexisted ? fs.readFileSync(writtenPath, 'utf8') : null;
  try {
    const output = await runCli(repoRoot);
    const parsed = JSON.parse(output);
    assert.equal(typeof parsed.path, 'string');
    assert.ok(parsed.path.includes(path.join('.swarmforge', 'briefing', 'lifecycle-snapshot.json')));
    assert.equal(typeof parsed.walked, 'boolean');
  } finally {
    // This CLI writes into the real worktree's .swarmforge/ (gitignored,
    // but still shared with any live daemon in this same worktree) -
    // restore whatever was there before this test ran, never leave a
    // stray artifact behind.
    if (preexisted) {
      fs.writeFileSync(writtenPath, priorContent, 'utf8');
    } else {
      fs.rmSync(writtenPath, { force: true });
    }
  }
});
