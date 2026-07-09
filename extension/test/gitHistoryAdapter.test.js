const assert = require('node:assert/strict');
const {
  parseGitLog,
  deriveTicketLifecycles,
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
