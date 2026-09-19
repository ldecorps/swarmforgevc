const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1642's three declared invariants:
//
// 1. A forwarding git_handoff held by the QA stage completes without a
//    stated reason iff a handoff of either kind (git_handoff or note),
//    queued in QA's own outbox/sent since the inbound's dequeue, names
//    the inbound's ticket; a note created before the dequeue, or naming
//    only another ticket, never completes it.
// 2. Note evidence is the QA stage's alone - every other role's
//    forwarding inbound keeps BL-1609's rule (git_handoff evidence only)
//    unchanged.
// 3. The forward gate and the BL-1566 hold gate decide QA-ness through
//    one shared seat-stage helper (qa-stage?), so any QA seat shape (a
//    bare "QA" row or a "QA@N" seat) is the QA stage, and no role whose
//    name merely CONTAINS "QA" is mistaken for it.
//
// BL-1637's own worked example established this file's shape: drive the
// REAL library functions (forward_evidence_lib.bb) via real bb
// subprocesses (SWARMFORGE_ROLE is process-env-scoped), never a
// reimplementation, generalizing past the acceptance feature's 9 fixed
// scenario rows via cell-coverage construction.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'forward_evidence_lib.bb');
const TICKET = 'BL-6464';
const OTHER_TICKET = 'BL-7373';

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

// ── Invariants 1 & 2: note evidence is QA-only, git_handoff evidence is
// universal, and both obey the same since/ticket-match rule ────────────

const ROLES = ['QA', 'architect'];
const EVIDENCE_KINDS = ['noteAfterMatch', 'noteBeforeMatch', 'noteOtherTicket', 'handoffAfterMatch', 'none'];
const CELLS_12 = ROLES.flatMap((r) => EVIDENCE_KINDS.map((e) => `${r}:${e}`));
const DRAWS_12 = 40;
const FLOOR_12 = runsPerCell(DRAWS_12, CELLS_12.length);

function buildFixture() {
  const root = mkTmpDir('sfvc-bl1642-prop-');
  const qaWt = path.join(root, 'QA');
  const architectWt = path.join(root, 'architect');
  for (const wt of [qaWt, architectWt]) {
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'outbox'), { recursive: true });
    fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'sent'), { recursive: true });
  }
  const rolesLine =
    `QA\tQA\t${qaWt}\tswarmforge-QA\tQa\tclaude\ttask\n` +
    `architect\tarchitect\t${architectWt}\tswarmforge-architect\tArchitect\tclaude\ttask\n`;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  for (const wt of [root, qaWt, architectWt]) {
    fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesLine);
  }
  return { root, qaWt, architectWt };
}

function wtFor(fixture, role) {
  return role === 'QA' ? fixture.qaWt : fixture.architectWt;
}

function clearOutbox(fixture, role) {
  const outbox = path.join(wtFor(fixture, role), '.swarmforge', 'handoffs', 'outbox');
  for (const f of fs.readdirSync(outbox)) fs.rmSync(path.join(outbox, f));
}

function seedEvidence(fixture, role, kind) {
  const outbox = path.join(wtFor(fixture, role), '.swarmforge', 'handoffs', 'outbox');
  if (kind === 'none') return;
  if (kind === 'handoffAfterMatch') {
    fs.writeFileSync(
      path.join(outbox, '90_e.handoff'),
      `id: e\nfrom: ${role}\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: ${role}\n` +
        `task: ${TICKET}-slug\ncommit: 9999999999\ncreated_at: ${isoSecondsAgo(10)}\n\nbody\n`
    );
    return;
  }
  const ticket = kind === 'noteOtherTicket' ? OTHER_TICKET : TICKET;
  const createdAt = kind === 'noteBeforeMatch' ? isoSecondsAgo(120) : isoSecondsAgo(10);
  fs.writeFileSync(
    path.join(outbox, '90_n.handoff'),
    `id: n\nfrom: ${role}\nto: coordinator\npriority: 50\ntype: note\n` +
      `message: ${ticket} approved and landed - bookkeep to done\ncreated_at: ${createdAt}\n\nbody\n`
  );
}

function checkOverallEvidenced(fixture, role, sinceIso) {
  const wt = wtFor(fixture, role);
  const program =
    `(load-file "${LIB_PATH}")` +
    `(let [h (forward-evidence-lib/sent-handoff-names-ticket-since? "${TICKET}" "${sinceIso}")` +
    `      qa (forward-evidence-lib/qa-stage?)` +
    `      n (and qa (forward-evidence-lib/sent-note-names-ticket-since? "${TICKET}" "${sinceIso}"))]` +
    `  (println (boolean (or h n))))`;
  const res = spawnSync('bb', ['-e', program], {
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: role },
  });
  assert.equal(res.status, 0, `bb subprocess failed: ${res.stderr}`);
  return res.stdout.trim() === 'true';
}

function expectedEvidenced(role, kind) {
  if (kind === 'handoffAfterMatch') return true; // universal, every role (BL-1609 unchanged)
  if (kind === 'noteAfterMatch') return role === 'QA'; // note evidence is QA-only (invariant 2)
  return false; // noteBeforeMatch, noteOtherTicket, none: stale or wrong ticket, never counts
}

test('property (BL-1642 invariants 1 & 2): note evidence completes a QA forward, never another role\'s, and both kinds obey the same since/ticket-match rule', () => {
  const fixture = buildFixture();
  const sinceIso = isoSecondsAgo(60);
  const cellCoverage = {};
  try {
    for (let i = 0; i < DRAWS_12; i += 1) {
      const role = ROLES[i % ROLES.length];
      const kind = EVIDENCE_KINDS[Math.floor(i / ROLES.length) % EVIDENCE_KINDS.length];
      const cell = `${role}:${kind}`;
      cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

      clearOutbox(fixture, 'QA');
      clearOutbox(fixture, 'architect');
      seedEvidence(fixture, role, kind);

      const evidenced = checkOverallEvidenced(fixture, role, sinceIso);
      const expected = expectedEvidenced(role, kind);
      assert.equal(
        evidenced,
        expected,
        `cell ${cell}: expected evidenced=${expected}, got ${evidenced}`
      );
    }
    assertReachFloor(cellCoverage, CELLS_12, FLOOR_12, 'bl1642 note-evidence cell');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// ── Invariant 3: qa-stage? recognizes every QA seat shape, and only QA ──

const QA_SEATS = ['QA', 'QA@2', 'QA@9', 'QA@a-long-seat-name'];
const NOT_QA_ROLES = ['architect', 'architect@2', 'QAX', 'XQA', 'qa', 'documenter@3', 'coordinator'];

function qaStageFor(role) {
  const program = `(load-file "${LIB_PATH}")(println (boolean (forward-evidence-lib/qa-stage?)))`;
  const res = spawnSync('bb', ['-e', program], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: role },
  });
  assert.equal(res.status, 0, `bb subprocess failed: ${res.stderr}`);
  return res.stdout.trim() === 'true';
}

test('property (BL-1642 invariant 3): qa-stage? recognizes a bare QA row and every QA@N seat, and no role merely containing "QA" in its name', () => {
  // Exhaustive over every case this invariant quantifies over (a small,
  // fully-enumerable role-shape space) - a stronger reach guarantee than
  // a sampled floor over it would give.
  for (const role of QA_SEATS) {
    assert.equal(qaStageFor(role), true, `expected qa-stage? true for seat "${role}"`);
  }
  for (const role of NOT_QA_ROLES) {
    assert.equal(qaStageFor(role), false, `expected qa-stage? false for role "${role}"`);
  }
});
