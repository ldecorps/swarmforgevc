const assert = require('node:assert/strict');
const {
  RITUAL_VOLUME_FLOOR,
  RITUAL_DOMINANCE_CEILING,
  RITUAL_CLASSES,
  normalizeCommitSubject,
  ritualClassesForPaths,
  buildRitualLedger,
  determinismCandidatesFromLedger,
  ritualClassIsNamedByText,
} = require('../out/metrics/ritualLedger');

// A class is identified by its path prefix, so a fixture builds commits by
// naming real repo paths rather than restating the class list.
const EVIDENCE_PATH = 'backlog/evidence/BL-1-coder-20260101.md';
const TOPIC_PATH = 'backlog/topics/BL-1.json';
const PROMOTION_PATH = 'backlog/active/BL-1-a-thing.yaml';

function commits(n, subjectFor, paths) {
  return Array.from({ length: n }, (_unused, i) => ({
    subject: subjectFor(i),
    paths,
  }));
}

function classStats(ledger, ritualClass) {
  return ledger.find((row) => row.ritualClass === ritualClass);
}

// ── subject normalization ────────────────────────────────────────────────

describe('normalizeCommitSubject', () => {
  it('collapses the ticket id, so one generated ritual reads as one subject', () => {
    assert.equal(
      normalizeCommitSubject('Close BL-1400: move to done. By coordinator.'),
      normalizeCommitSubject('Close BL-1275: move to done. By coordinator.')
    );
  });

  it('collapses commit hashes', () => {
    assert.equal(
      normalizeCommitSubject('Merge main e9e4be7886 into coder to sync up.'),
      normalizeCommitSubject('Merge main 18ae284e5b into coder to sync up.')
    );
  });

  it('collapses dates and bare numbers', () => {
    assert.equal(
      normalizeCommitSubject('BL topic record for 2026-09-04 (7 rows)'),
      normalizeCommitSubject('BL topic record for 2026-08-30 (12 rows)')
    );
  });

  it('keeps genuinely different prose apart', () => {
    assert.notEqual(
      normalizeCommitSubject('BL-1: fold the two window-record builders into one.'),
      normalizeCommitSubject('BL-1: record the second guard refusal.')
    );
  });
});

// ── path → ritual class ──────────────────────────────────────────────────

describe('ritualClassesForPaths', () => {
  it('attributes a commit to every area it touches', () => {
    const found = ritualClassesForPaths([EVIDENCE_PATH, TOPIC_PATH]);
    assert.deepEqual([...found].sort(), ['pass-bounce-evidence', 'topic-records'].sort());
  });

  it('names each class exactly once however many of its paths a commit touches', () => {
    const found = ritualClassesForPaths([
      'backlog/evidence/a.md',
      'backlog/evidence/b.md',
      'backlog/evidence/c.md',
    ]);
    assert.deepEqual(found, ['pass-bounce-evidence']);
  });

  it('ignores a path in no known area rather than inventing a class', () => {
    assert.deepEqual(ritualClassesForPaths(['README.md']), []);
  });

  it('declares every class with a non-empty path prefix and label', () => {
    assert.ok(RITUAL_CLASSES.length > 0);
    for (const cls of RITUAL_CLASSES) {
      assert.ok(cls.id.length > 0, 'class id');
      assert.ok(cls.pathPrefix.length > 0, `${cls.id} pathPrefix`);
      assert.ok(cls.label.length > 0, `${cls.id} label`);
    }
  });
});

// ── the ledger fold ──────────────────────────────────────────────────────

describe('buildRitualLedger', () => {
  it('computes volume, top subject and dominance per class', () => {
    const ledger = buildRitualLedger(
      commits(10, () => 'Close BL-1: move to done. By coordinator.', [PROMOTION_PATH])
    );
    const row = classStats(ledger, 'backlog-promotion');
    assert.equal(row.commits, 10);
    assert.equal(row.topSubjectCount, 10);
    assert.equal(row.dominance, 1);
    assert.equal(row.distinctSubjects, 1);
  });

  it('a class whose subjects all differ has dominance at its floor', () => {
    const ledger = buildRitualLedger(
      commits(10, (i) => `hand written subject number ${'x'.repeat(i + 1)}`, [EVIDENCE_PATH])
    );
    const row = classStats(ledger, 'pass-bounce-evidence');
    assert.equal(row.commits, 10);
    assert.equal(row.topSubjectCount, 1);
    assert.equal(row.dominance, 0.1);
    assert.equal(row.distinctSubjects, 10);
  });

  it('counts one commit under each class it touches', () => {
    const ledger = buildRitualLedger([{ subject: 'one commit', paths: [EVIDENCE_PATH, TOPIC_PATH] }]);
    assert.equal(classStats(ledger, 'pass-bounce-evidence').commits, 1);
    assert.equal(classStats(ledger, 'topic-records').commits, 1);
  });

  it('omits a class no commit touched, rather than reporting it as zero', () => {
    const ledger = buildRitualLedger([{ subject: 's', paths: [EVIDENCE_PATH] }]);
    assert.equal(classStats(ledger, 'topic-records'), undefined);
  });

  it('is empty for no commits', () => {
    assert.deepEqual(buildRitualLedger([]), []);
  });
});

// ── candidate selection ──────────────────────────────────────────────────

describe('determinismCandidatesFromLedger', () => {
  const scripted = commits(
    RITUAL_VOLUME_FLOOR + 10,
    () => 'Close BL-1: move to done. By coordinator.',
    [PROMOTION_PATH]
  );
  const handMade = commits(
    RITUAL_VOLUME_FLOOR + 10,
    (i) => `a different hand written subject ${'y'.repeat(i + 1)}`,
    [EVIDENCE_PATH]
  );
  const lowVolumeVaried = commits(
    Math.max(1, RITUAL_VOLUME_FLOOR - 10),
    (i) => `sparse varied subject ${'z'.repeat(i + 1)}`,
    [TOPIC_PATH]
  );

  it('does not offer a class one subject dominates (scenario 01)', () => {
    const found = determinismCandidatesFromLedger(buildRitualLedger(scripted), []);
    assert.deepEqual(found, []);
  });

  it('offers a high-volume class whose subjects vary widely (scenario 02)', () => {
    const found = determinismCandidatesFromLedger(buildRitualLedger(handMade), []);
    assert.deepEqual(
      found.map((c) => c.ritualClass),
      ['pass-bounce-evidence']
    );
  });

  it('the candidate carries its volume and its subject spread (scenario 02)', () => {
    const [candidate] = determinismCandidatesFromLedger(buildRitualLedger(handMade), []);
    assert.equal(candidate.commits, RITUAL_VOLUME_FLOOR + 10);
    assert.equal(candidate.distinctSubjects, RITUAL_VOLUME_FLOOR + 10);
    assert.ok(candidate.dominance < RITUAL_DOMINANCE_CEILING);
    assert.ok(candidate.label.length > 0);
  });

  it('does not offer a varied class below the volume floor', () => {
    const found = determinismCandidatesFromLedger(buildRitualLedger(lowVolumeVaried), []);
    assert.deepEqual(found, []);
  });

  it('does not offer a class an open ticket already names (scenario 03)', () => {
    const ledger = buildRitualLedger(handMade);
    const openTickets = ['title: make evidence deterministic\nritual_class: pass-bounce-evidence\n'];
    assert.deepEqual(determinismCandidatesFromLedger(ledger, openTickets), []);
  });

  it('offers nothing when every class is scripted or ticketed (scenario 04)', () => {
    const ledger = buildRitualLedger([...scripted, ...handMade]);
    const openTickets = ['ritual_class: pass-bounce-evidence\n'];
    assert.deepEqual(determinismCandidatesFromLedger(ledger, openTickets), []);
  });

  it('ranks the most voluminous candidate first', () => {
    const smaller = commits(
      RITUAL_VOLUME_FLOOR + 5,
      (i) => `varied topic subject ${'q'.repeat(i + 1)}`,
      [TOPIC_PATH]
    );
    const found = determinismCandidatesFromLedger(buildRitualLedger([...handMade, ...smaller]), []);
    assert.deepEqual(
      found.map((c) => c.ritualClass),
      ['pass-bounce-evidence', 'topic-records']
    );
  });
});

describe('ritualClassIsNamedByText', () => {
  const evidenceClass = RITUAL_CLASSES.find((c) => c.id === 'pass-bounce-evidence');

  it('matches a ticket declaring the class id', () => {
    assert.equal(ritualClassIsNamedByText(evidenceClass, 'ritual_class: pass-bounce-evidence\n'), true);
  });

  it('matches a declaration in a list', () => {
    assert.equal(
      ritualClassIsNamedByText(evidenceClass, 'ritual_class: [backlog-closure, pass-bounce-evidence]\n'),
      true
    );
  });

  it('matches a quoted declaration', () => {
    assert.equal(ritualClassIsNamedByText(evidenceClass, "ritual_class: 'pass-bounce-evidence'\n"), true);
  });

  it('does not match a ticket declaring a DIFFERENT class', () => {
    assert.equal(ritualClassIsNamedByText(evidenceClass, 'ritual_class: topic-records\n'), false);
  });

  // The live-backlog refutation, pinned as a test: 23 of 104 open tickets
  // mention this path incidentally, and none of them is about the ritual.
  it('does not match a ticket that merely mentions the class path', () => {
    assert.equal(
      ritualClassIsNamedByText(evidenceClass, 'description: the guard deletes backlog/evidence/ files on refusal'),
      false
    );
  });

  it('does not match a ticket that merely mentions the id in prose', () => {
    assert.equal(ritualClassIsNamedByText(evidenceClass, 'see the pass-bounce-evidence numbers'), false);
  });

  it('does not match an unrelated ticket', () => {
    assert.equal(ritualClassIsNamedByText(evidenceClass, 'the front desk drops images'), false);
  });
});
