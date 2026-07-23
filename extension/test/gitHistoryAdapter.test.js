const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseGitLog,
  deriveTicketLifecycles,
  parseMergeLog,
  runGitLog,
} = require('../out/metrics/gitHistoryAdapter');

// BL-096: parseGitLog is a pure text parser over `git log
// --format=COMMIT%x09%H%x09%cI --name-status -M --reverse` output - every
// test here drives it with a fixed fake string, never a real git repo, so
// the adapter is testable without live git (acceptance's own non-behavioral
// gate).

function commitLine(hash, dateIso) {
  return `COMMIT\t${hash}\t${dateIso}`;
}

test('parseGitLog parses a single commit with one added file', () => {
  const output = [
    commitLine('aaa111', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
  ].join('\n');

  const entries = parseGitLog(output);
  assert.deepEqual(entries, [
    {
      commit: 'aaa111',
      dateIso: '2026-01-01T00:00:00Z',
      changes: [{ status: 'A', path: 'backlog/active/BL-001-example.yaml' }],
    },
  ]);
});

test('parseGitLog parses multiple commits in order', () => {
  const output = [
    commitLine('aaa111', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
    commitLine('bbb222', '2026-01-02T00:00:00Z'),
    'A\tbacklog/active/BL-002-other.yaml',
    '',
  ].join('\n');

  const entries = parseGitLog(output);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].commit, 'aaa111');
  assert.equal(entries[1].commit, 'bbb222');
});

test('parseGitLog parses a rename (move between backlog folders) with old and new paths', () => {
  const output = [
    commitLine('ccc333', '2026-01-03T00:00:00Z'),
    'R100\tbacklog/active/BL-001-example.yaml\tbacklog/done/BL-001-example.yaml',
    '',
  ].join('\n');

  const entries = parseGitLog(output);
  assert.deepEqual(entries[0].changes, [
    {
      status: 'R100',
      oldPath: 'backlog/active/BL-001-example.yaml',
      path: 'backlog/done/BL-001-example.yaml',
    },
  ]);
});

test('parseGitLog ignores a commit with no name-status lines (e.g. an empty merge)', () => {
  const output = [
    commitLine('ddd444', '2026-01-04T00:00:00Z'),
    '',
    commitLine('eee555', '2026-01-05T00:00:00Z'),
    'A\tbacklog/active/BL-003-third.yaml',
    '',
  ].join('\n');

  const entries = parseGitLog(output);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].changes, []);
  assert.equal(entries[1].changes.length, 1);
});

test('parseGitLog returns an empty array for empty output', () => {
  assert.deepEqual(parseGitLog(''), []);
});

// ── runGitLog (impure - shells out to real git) - BL-549 maxBuffer/ENOBUFS ──
//
// BL-549: execFileSync's default maxBuffer is 1 MiB, which this repo's own
// full-history output now exceeds. The regression this ticket guards against
// is specifically the *default* maxBuffer= parameter on runGitLog (no
// explicit override) handling output over the OLD 1 MiB cap - so
// buildOversizedTestRepo below genuinely builds a repo whose full-history
// name-status output exceeds 1 MiB (one commit, many long-named files - a
// few hundred ms, no need for a real multi-year repo) and asserts against
// its actual byte length rather than assumed math. A second test still
// forces overflow via an explicit tiny maxBuffer, to cover the
// diagnostic-logging path deterministically.

function initTestRepo() {
  const dir = mkTmpDir('sfvc-git-history-adapter-');
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'example.txt'), 'hello');
  execSync('git add example.txt', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "add example.txt"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

const ONE_MIB = 1024 * 1024;

function buildOversizedTestRepo() {
  const dir = mkTmpDir('sfvc-git-history-adapter-oversized-');
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  const subdir = 'd'.repeat(200);
  fs.mkdirSync(path.join(dir, subdir));
  for (let i = 0; i < 3000; i++) {
    const name = String(i).padStart(6, '0') + 'x'.repeat(190);
    fs.writeFileSync(path.join(dir, subdir, name), '1');
  }
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -q -m "bulk"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

test('runGitLog returns parsed entries for a real repo within the default maxBuffer', () => {
  const dir = initTestRepo();
  const entries = runGitLog(dir, '.');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].changes, [{ status: 'A', path: 'example.txt' }]);
});

test('runGitLog, called with only its default maxBuffer (no explicit override), still returns parsed entries once full-history name-status output genuinely exceeds the old 1 MiB execFileSync default', () => {
  const dir = buildOversizedTestRepo();
  const rawOutput = execSync(
    'git log HEAD --format=COMMIT%x09%H%x09%cI --name-status -M --reverse -- .',
    { cwd: dir, maxBuffer: 64 * 1024 * 1024 }
  );
  assert.ok(
    Buffer.byteLength(rawOutput) > ONE_MIB,
    `test repo fixture must itself exceed 1 MiB to guard the real boundary; was ${Buffer.byteLength(rawOutput)} bytes`
  );

  const entries = runGitLog(dir, '.');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].changes.length, 3000);
});

test('runGitLog returns [] and logs a diagnostic to stderr when the read overflows an explicit maxBuffer (ENOBUFS), instead of throwing', () => {
  const dir = initTestRepo();
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stderr = [];
  process.stderr.write = (chunk) => {
    stderr.push(chunk);
    return true;
  };

  let entries;
  try {
    entries = runGitLog(dir, '.', 'HEAD', 10);
  } finally {
    process.stderr.write = originalStderrWrite;
  }

  assert.deepEqual(entries, []);
  assert.match(stderr.join(''), /runGitLog.*failed/i);
});

// ── deriveTicketLifecycles (pure, over a provided entry list) ───────────

test('deriveTicketLifecycles records the spec date as the earliest arrival of a ticket file anywhere under backlog/', () => {
  const entries = parseGitLog(
    [commitLine('aaa', '2026-01-01T00:00:00Z'), 'A\tbacklog/active/BL-001-example.yaml', ''].join('\n')
  );
  const lifecycles = deriveTicketLifecycles(entries);
  assert.deepEqual(lifecycles.get('BL-001'), {
    ticketId: 'BL-001',
    specDateIso: '2026-01-01T00:00:00Z',
    closeDateIso: null,
  });
});

test('deriveTicketLifecycles records the close date once the ticket file arrives under backlog/done/', () => {
  const output = [
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
    commitLine('bbb', '2026-01-10T00:00:00Z'),
    'R100\tbacklog/active/BL-001-example.yaml\tbacklog/done/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.deepEqual(lifecycles.get('BL-001'), {
    ticketId: 'BL-001',
    specDateIso: '2026-01-01T00:00:00Z',
    closeDateIso: '2026-01-10T00:00:00Z',
  });
});

test('deriveTicketLifecycles handles a milestone subfolder path under backlog/done/', () => {
  const output = [
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
    commitLine('bbb', '2026-01-10T00:00:00Z'),
    'R100\tbacklog/active/BL-001-example.yaml\tbacklog/done/M2/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.get('BL-001').closeDateIso, '2026-01-10T00:00:00Z');
});

test('deriveTicketLifecycles keeps the earliest close date if a ticket is re-milestoned (moved again within done/)', () => {
  const output = [
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
    commitLine('bbb', '2026-01-10T00:00:00Z'),
    'R100\tbacklog/active/BL-001-example.yaml\tbacklog/done/BL-001-example.yaml',
    '',
    commitLine('ccc', '2026-01-15T00:00:00Z'),
    'R100\tbacklog/done/BL-001-example.yaml\tbacklog/done/M2/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.get('BL-001').closeDateIso, '2026-01-10T00:00:00Z');
});

test('deriveTicketLifecycles keeps the earliest spec date even if entries arrive out of chronological order', () => {
  const output = [
    commitLine('bbb', '2026-01-10T00:00:00Z'),
    'A\tbacklog/paused/BL-001-example.yaml',
    '',
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.get('BL-001').specDateIso, '2026-01-01T00:00:00Z');
});

test('deriveTicketLifecycles leaves closeDateIso null for a ticket never seen under backlog/done/', () => {
  const output = [commitLine('aaa', '2026-01-01T00:00:00Z'), 'A\tbacklog/active/BL-001-example.yaml', ''].join('\n');
  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.get('BL-001').closeDateIso, null);
});

test('deriveTicketLifecycles extracts the ticket id from a bare filename with no title slug', () => {
  const output = [commitLine('aaa', '2026-01-01T00:00:00Z'), 'A\tbacklog/active/BL-101.yaml', ''].join('\n');
  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.ok(lifecycles.has('BL-101'));
});

test('deriveTicketLifecycles ignores changes to files that are not ticket yaml files', () => {
  const output = [commitLine('aaa', '2026-01-01T00:00:00Z'), 'A\tbacklog/README.md', ''].join('\n');
  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.size, 0);
});

test('deriveTicketLifecycles tracks multiple distinct tickets independently', () => {
  const output = [
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    'A\tbacklog/active/BL-002-other.yaml',
    '',
    commitLine('bbb', '2026-01-05T00:00:00Z'),
    'R100\tbacklog/active/BL-001-example.yaml\tbacklog/done/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(lifecycles.get('BL-001').closeDateIso, '2026-01-05T00:00:00Z');
  assert.equal(lifecycles.get('BL-002').closeDateIso, null);
});

test('deriveTicketLifecycles ignores a plain content edit (M status) - it is not an arrival', () => {
  const output = [
    commitLine('aaa', '2026-01-01T00:00:00Z'),
    'A\tbacklog/active/BL-001-example.yaml',
    '',
    commitLine('bbb', '2026-01-03T00:00:00Z'),
    'M\tbacklog/active/BL-001-example.yaml',
    '',
  ].join('\n');

  const lifecycles = deriveTicketLifecycles(parseGitLog(output));
  assert.equal(
    lifecycles.get('BL-001').specDateIso,
    '2026-01-01T00:00:00Z',
    'a later content edit must not be mistaken for a new arrival'
  );
});

// ── parseMergeLog (pure) — BL-094 recent-activity's "merges to main" ────

function mergeLine(commit, dateIso, subject) {
  return `${commit}\t${dateIso}\t${subject}`;
}

test('parseMergeLog parses a single merge line into commit/date/subject', () => {
  const output = mergeLine('abc1234567', '2026-07-09T10:00:00Z', 'Merge QA-approved BL-096-metrics-computation');
  const entries = parseMergeLog(output);
  assert.deepEqual(entries, [
    { commit: 'abc1234567', dateIso: '2026-07-09T10:00:00Z', subject: 'Merge QA-approved BL-096-metrics-computation' },
  ]);
});

test('parseMergeLog parses multiple lines in order', () => {
  const output = [mergeLine('aaa', '2026-07-09T10:00:00Z', 'first'), mergeLine('bbb', '2026-07-09T11:00:00Z', 'second')].join('\n');
  const entries = parseMergeLog(output);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].commit, 'aaa');
  assert.equal(entries[1].commit, 'bbb');
});

test('parseMergeLog preserves a subject that itself contains tab-adjacent punctuation without truncating', () => {
  const output = mergeLine('aaa', '2026-07-09T10:00:00Z', 'Merge commit x: y - z (details)');
  const entries = parseMergeLog(output);
  assert.equal(entries[0].subject, 'Merge commit x: y - z (details)');
});

test('parseMergeLog ignores blank lines', () => {
  const output = ['', mergeLine('aaa', '2026-07-09T10:00:00Z', 'first'), ''].join('\n');
  assert.equal(parseMergeLog(output).length, 1);
});

test('parseMergeLog returns an empty array for empty output', () => {
  assert.deepEqual(parseMergeLog(''), []);
});
