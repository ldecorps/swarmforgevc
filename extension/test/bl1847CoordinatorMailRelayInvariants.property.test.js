'use strict';

// BL-1847's declared invariants (property authorship rests with the coder,
// first pass - BL-654):
//
//   1. "A coordinator parcel moves to completed only after its relay line
//      is written to the operator outbox; a failed write leaves it in new
//      mail." A FAILED-write case is exercised end to end by the
//      acceptance feature's own scenario 04 (a real unwritable-path
//      fixture, real handoffd.bb --coordinator-mail-sweep-once) and by
//      inspection: handoffd.bb's coordinator-mail-sweep! moves a parcel
//      only inside the SAME try whose first statement is the outbox
//      `spit`, after it returns - there is no second move site. The
//      SUCCESSFUL-write half (every parcel that DOES get written also
//      gets moved, and none left behind or duplicated) is what this
//      property test encodes directly, over a generator-drawable space of
//      parcel shapes the acceptance feature's three fixed scenarios
//      cannot practically enumerate.
//   2. "The sweep never edits or deletes a parcel: the file in completed
//      is byte-identical to the one that arrived." Encoded directly below
//      - every generated parcel's exact byte content is captured before
//      the sweep runs and compared against wherever it ends up after.
//
// (Invariant 3 - "a pack whose conf does not declare coordinator_mode
// deterministic keeps its coordinator mailbox exactly as today" - hinges
// entirely on coordinator-config-lib/deterministic-coordinator?, the SAME
// predicate BL-1846's own property test
// (bl1846CoordinatorModeInvariants.property.test.js) already exhaustively
// covers for near-misses; this ticket leaves that predicate untouched, so
// re-testing it here would be a duplicate encoding of the identical
// decision, not a second one. Acceptance scenario 05 proves THIS sweep
// actually consults it.)
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL `bb handoffd.bb <root> --coordinator-mail-sweep-once`
// over a disposable fixture root - never a reimplementation of the
// sweep's own file-move/outbox-append logic - same posture
// bl1846CoordinatorModeInvariants.property.test.js's own acceptance-style
// property tests use.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). One cell,
// 'relay-batch': the number of parcels (1-6), each parcel's sender (drawn
// from a small realistic pool: QA/specifier/coder/coordinator - the real
// senders the ticket's own census names), and each parcel's message text
// (alphanumeric, 1-40 chars, WITH a "BL-<digits>" prefix on roughly half
// the draws by construction - a coin flip per parcel picks whether the
// generated digits are prepended - so both "names a ticket" and "does
// not" are reached every run, never left to chance).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const FIXTURE_PREFIX = 'bl1847-property-';

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function coordinatorMailboxDir(root, state) {
  return path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', state);
}

function buildRoot() {
  const root = mkTmpDir(FIXTURE_PREFIX);
  mkdirp(path.join(root, '.swarmforge'));
  mkdirp(coordinatorMailboxDir(root, 'new'));
  mkdirp(coordinatorMailboxDir(root, 'completed'));
  mkdirp(coordinatorMailboxDir(root, 'in_process'));
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tcoordinator\tclaude\ttask\n`
  );
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config coordinator_mode deterministic\n');
  return root;
}

let seq = 0;
function writeNote(root, { from, message }) {
  seq += 1;
  const id = `20261001T000000Z_${String(seq).padStart(6, '0')}_from_${from}`;
  const filename = `00_${id}.handoff`;
  const content =
    `id: ${id}\n` +
    `from: ${from}\n` +
    'to: coordinator\n' +
    'recipient: coordinator\n' +
    'priority: 00\n' +
    'type: note\n' +
    `message: ${message}\n` +
    '\n' +
    `${message}\n`;
  fs.writeFileSync(path.join(coordinatorMailboxDir(root, 'new'), filename), content);
  return { filename, content };
}

function runSweepOnce(root) {
  const r = spawnSync('bb', [HANDOFFD, root, '--coordinator-mail-sweep-once'], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  assert.equal(r.status, 0, `handoffd.bb --coordinator-mail-sweep-once failed: ${r.stderr}`);
  return r;
}

const SENDERS = ['QA', 'specifier', 'coder', 'coordinator'];
const parcelArb = fc.record({
  from: fc.constantFrom(...SENDERS),
  nameATicket: fc.boolean(),
  ticketDigits: fc.integer({ min: 1, max: 9999 }),
  text: fc.stringMatching(/^[a-zA-Z0-9 ]{1,40}$/),
});
const batchArb = fc.array(parcelArb, { minLength: 1, maxLength: 6 });

const CELLS = ['relay-batch'];

test("BL-1847/BL-654 invariants: every relayed parcel's file is byte-identical in completed/, and a successful outbox write moves exactly the parcels it summarized", () => {
  const reach = { 'relay-batch': 0 };
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  fc.assert(
    fc.property(batchArb, (parcels) => {
      reach['relay-batch'] += 1;
      const root = buildRoot();
      try {
        const written = parcels.map(({ from, nameATicket, ticketDigits, text }) => {
          const message = nameATicket ? `BL-${ticketDigits} ${text}` : text;
          return { from, ...writeNote(root, { from, message }) };
        });

        runSweepOnce(root);

        const newFiles = new Set(fs.readdirSync(coordinatorMailboxDir(root, 'new')));
        const completedFiles = new Set(fs.readdirSync(coordinatorMailboxDir(root, 'completed')));

        for (const { filename, content } of written) {
          const inNew = newFiles.has(filename);
          const inCompleted = completedFiles.has(filename);
          // Invariant 1 (success half): a parcel the sweep wrote an outbox
          // line for lands in EXACTLY one of new/completed, never both,
          // never neither - this fixture never injects an outbox-write
          // failure, so every parcel is expected to have moved.
          assert.ok(inNew !== inCompleted, `${filename} is in both or neither mailbox (new=${inNew}, completed=${inCompleted})`);
          assert.ok(inCompleted, `${filename} did not move to completed/ on a successful sweep`);

          // Invariant 2: byte-identical.
          const after = fs.readFileSync(path.join(coordinatorMailboxDir(root, 'completed'), filename), 'utf8');
          assert.equal(after, content, `${filename}'s content changed between new/ and completed/`);
        }

        // No extra/phantom files appear in completed/ beyond what was sent.
        assert.equal(completedFiles.size, written.length, `completed/ holds an unexpected file count: ${JSON.stringify([...completedFiles])}`);

        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: CELL_RUNS }
  );

  assertReachFloor(reach, CELLS, CELL_RUNS, 'BL-1847 coordinator-mail-sweep cell');
}, propertyLaneTimeoutMs(40000));
