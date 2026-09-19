const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1637's declared invariant: "A forward a seat sent after dequeuing a
// parcel is found by that seat's completion gate wherever the daemon
// filed it, and a forward sent before the dequeue, or none, is never
// accepted." BL-1637's own acceptance scenario 01 pins this at 4 fixed
// outline rows; this generalizes over WHICH of the seat's 4 scanned
// directories (its own outbox/sent, or its stage's outbox/sent) carries
// the evidence, crossed with whether it was created before or after the
// dequeue - 8 cells, each reached by CONSTRUCTION (i % 8 over 32 draws,
// runsPerCell/assertReachFloor - BL-1584/BL-1589, never sampled and
// hoped for), driving the REAL sent-handoff-names-ticket-since? via a
// real bb subprocess (SWARMFORGE_ROLE is process-env-scoped).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'forward_evidence_lib.bb');
const TICKET = 'BL-6464';

const DIR_CELLS = ['ownOutbox', 'ownSent', 'stageOutbox', 'stageSent'];
const TIMING_CELLS = ['before', 'after'];
const CELLS = DIR_CELLS.flatMap((d) => TIMING_CELLS.map((t) => `${d}:${t}`));
const DRAWS = 32;
const CELL_FLOOR = runsPerCell(DRAWS, CELLS.length);

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function buildFixture() {
  const root = mkTmpDir('sfvc-bl1637-prop-');
  const coderWt = path.join(root, 'coder');
  const coder2Wt = path.join(root, 'coder2');
  for (const wt of [coderWt, coder2Wt]) {
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'outbox'), { recursive: true });
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'sent'), { recursive: true });
  }
  const rolesLine =
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
    `coder@2\tcoder2\t${coder2Wt}\tswarmforge-coder2\tCoder@2\tclaude\ttask\n`;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  for (const wt of [root, coderWt, coder2Wt]) {
    fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
  }
  return { root, coderWt, coder2Wt };
}

function dirFor(fixture, dirCell) {
  const [seatOrStage, state] = [dirCell.startsWith('own') ? 'own' : 'stage', dirCell.endsWith('Outbox') ? 'outbox' : 'sent'];
  const wt = seatOrStage === 'own' ? fixture.coder2Wt : fixture.coderWt;
  return path.join(wt, '.swarmforge', 'handoffs', state);
}

function checkEvidence(fixture, sinceIso) {
  const program =
    `(load-file "${LIB_PATH}")` +
    `(println (boolean (forward-evidence-lib/sent-handoff-names-ticket-since? "${TICKET}" "${sinceIso}")))`;
  const res = spawnSync('bb', ['-e', program], {
    cwd: fixture.coder2Wt,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'coder@2' },
  });
  assert.equal(res.status, 0, `bb subprocess failed: ${res.stderr}`);
  return res.stdout.trim() === 'true';
}

test('property (BL-1637): the seat completion gate finds a post-dequeue forward wherever it was filed, and never a pre-dequeue one', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const dirCell = DIR_CELLS[i % DIR_CELLS.length];
    const timingCell = TIMING_CELLS[Math.floor(i / DIR_CELLS.length) % TIMING_CELLS.length];
    const cell = `${dirCell}:${timingCell}`;
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

    const fixture = buildFixture();
    const dequeuedAt = isoSecondsAgo(60);
    const createdAt = timingCell === 'after' ? isoSecondsAgo(30) : isoSecondsAgo(120);
    const dir = dirFor(fixture, dirCell);
    fs.writeFileSync(
      path.join(dir, '90_evidence.handoff'),
      `id: fwd1\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: coder\n` +
        `task: ${TICKET}-some-slug\ncommit: 9999999999\ncreated_at: ${createdAt}\n\n` +
        `merge_and_process coder 9999999999\n`
    );

    const evidenced = checkEvidence(fixture, dequeuedAt);
    const expected = timingCell === 'after';
    assert.equal(
      evidenced,
      expected,
      `cell ${cell}: expected evidenced=${expected}, got ${evidenced} (dequeuedAt=${dequeuedAt}, createdAt=${createdAt})`
    );

    fs.rmSync(fixture.root, { recursive: true, force: true });
  }

  assertReachFloor(cellCoverage, CELLS, CELL_FLOOR, 'bl1637 cell');
});
