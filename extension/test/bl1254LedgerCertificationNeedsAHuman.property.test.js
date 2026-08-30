'use strict';

// BL-1254 invariant 2, coder-authored per BL-654:
//
//   "Green tests alone never write certified or waived into the hotfix
//    ledger; only a recorded human decision does."
//
// The acceptance scenario checks the three rows of THIS chain, in the repo's
// own ledger, at the end of this parcel. That is one instance of the claim.
// The claim itself is about the mechanism: the ONE tool that writes the ledger
// (swarmforge/scripts/hotfix_ledger_update.bb) must have no path from its
// non-decision operations to a certified or waived state, whatever sequence
// of them a green run performs. `--link` is exactly what a stamp-off run
// does, repeatedly, and it is the operation that would be quietly catastrophic
// if it ever carried a state change with it.
//
// So this drives the REAL updater over a REAL ledger file across generated
// operation sequences, and asserts no row ever reaches certified/waived
// without --decide.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const UPDATER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'hotfix_ledger_update.bb');

const DECIDED_STATES = ['certified', 'waived'];

function ledgerPath(root) {
  return path.join(root, 'backlog', 'hotfix-ledger.yaml');
}

function makeRoot() {
  const root = mkTmpDir('bl1254-ledger-');
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  return root;
}

/** The real updater. Returns its exit status; a refusal is a legal outcome. */
function update(root, ...args) {
  try {
    execFileSync('bb', [UPDATER, root, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

/** Every row the ledger holds, as {commit, state, humanDecision}. */
function rows(root) {
  const file = ledgerPath(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/^- commit: /m)
    .slice(1)
    .map((row) => ({
      commit: row.split('\n')[0].trim(),
      state: (/\n\s*state:\s*(\S+)/.exec(row) || [])[1],
      humanDecision: (/\n\s*human_decision:\s*(\S+)/.exec(row) || [])[1],
    }));
}

// Commit ids the updater will accept, in two disjoint pools so a generated
// link can be aimed at a row that exists or at one that never will, BY
// CONSTRUCTION rather than by luck. An earlier draft drew both from one pool
// and asserted the reach afterwards; it went red on an unlucky seed inside the
// full property lane, which is exactly the failure the reach floor is meant to
// catch in the generator rather than in the suite.
const PRESENT = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'];
const ABSENT = ['dddddddddd', 'eeeeeeeeee'];

const ticketArb = fc.constantFrom('BL-1254', 'BL-1259', 'BL-848');
const linkArb = (pool, existing) =>
  fc.record({ kind: fc.constant('link'), existing: fc.constant(existing) })
    .chain((base) =>
      fc.record({
        kind: fc.constant(base.kind),
        existing: fc.constant(existing),
        commit: fc.constantFrom(...pool),
        ticket: ticketArb,
      })
    );

// Every scenario creates at least one row, then links at least one row that
// exists and at least one that does not, plus any number of further links in
// any order.
const scenarioArb = fc
  .record({
    created: fc.uniqueArray(fc.constantFrom(...PRESENT), { minLength: 1, maxLength: 3 }),
    hit: linkArb(PRESENT, true),
    miss: linkArb(ABSENT, false),
    extra: fc.array(
      fc.oneof(linkArb(PRESENT, true), linkArb(ABSENT, false)),
      { maxLength: 3 }
    ),
  })
  .map(({ created, hit, miss, extra }) => ({
    // Only the drawn `created` commits are made, so a link at PRESENT can
    // still miss - the invariant holds either way.
    creates: created.map((commit) => ({ kind: 'new', commit })),
    links: [hit, miss, ...extra],
  }));

describe('BL-1254 invariant 2: only a recorded human decision certifies a hotfix', () => {
  it('never reaches certified or waived through the operations a green run performs', () => {
    // Asserted reach, not hoped-for: a run that only ever created rows would
    // never exercise --link at all, and a run whose --links all missed would
    // never exercise the write path this invariant is about.
    const reached = { linkedExisting: 0, linkedMissing: 0, created: 0 };

    fc.assert(
      fc.property(scenarioArb, ({ creates, links }) => {
        const root = makeRoot();
        for (const op of creates) {
          update(root, '--new', op.commit, 'a hotfix subject', '2026-08-28');
          reached.created += 1;
        }
        for (const link of links) {
          const existed = rows(root).some((r) => r.commit === link.commit);
          update(root, '--link', link.commit, link.ticket);
          if (existed) reached.linkedExisting += 1;
          else reached.linkedMissing += 1;
        }

        for (const row of rows(root)) {
          assert.ok(
            !DECIDED_STATES.includes(row.state),
            `${row.commit} reached ${row.state} with no human decision`
          );
          assert.equal(
            row.humanDecision,
            'null',
            `${row.commit} carries a human decision no human made`
          );
        }
      }),
      { numRuns: 12 }
    );

    assert.ok(reached.created > 0, 'the generator never created a ledger row');
    assert.ok(reached.linkedExisting > 0, 'the generator never linked an existing row');
    assert.ok(reached.linkedMissing > 0, 'the generator never linked a row that was not there');
  });

  it('does certify when a human decision is recorded', () => {
    // Non-vacuity: the property above is not true merely because the updater
    // never writes state at all. --decide is the one path that does, and it
    // is the path a human runs by hand.
    const root = makeRoot();
    update(root, '--new', 'aaaaaaaaaa', 'a hotfix subject', '2026-08-28');
    update(root, '--link', 'aaaaaaaaaa', 'BL-1254');
    assert.deepEqual(rows(root), [
      { commit: 'aaaaaaaaaa', state: 'pending', humanDecision: 'null' },
    ]);

    update(root, '--decide', 'aaaaaaaaaa', 'approved', '2026-08-30');
    assert.deepEqual(rows(root), [
      { commit: 'aaaaaaaaaa', state: 'certified', humanDecision: 'approved' },
    ]);

    update(root, '--new', 'bbbbbbbbbb', 'another hotfix subject', '2026-08-28');
    update(root, '--decide', 'bbbbbbbbbb', 'waived', '2026-08-30');
    assert.equal(rows(root).find((r) => r.commit === 'bbbbbbbbbb').state, 'waived');
  });
});
