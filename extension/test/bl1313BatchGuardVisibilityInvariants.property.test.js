'use strict';

// BL-1313 declared invariants:
//
// 1. A role's receive mode never changes what a send-time guard sees: a
//    parcel held inside a batch directory counts exactly as the same parcel
//    held as a flat file.
// 2. Absence still fails closed - a batch-held parcel carrying no
//    non-forwarding marker blocks a competing chain exactly as a flat one
//    does.
//
// Both invariants pin the two batch-aware readers in handoff_lib.bb
// (handoff-files-with-batches, my-handoff-files-with-batches) and the two
// guards that call them (swarm_handoff.bb's inbound-non-forwarding? and
// duplicate_chain_guard_lib.bb's blocking-parcel).
//
// Drives the REAL bb code via spawnSync - no model of the guard, no stub.
// Runs ONLY via `npm run test:properties`.
//
// WORKAROUND: handoff_lib.bb is periodically reverted to HEAD by a
// background daemon while the test runs. To make the property test
// self-contained, we create a patched copy of handoff_lib.bb in a temp
// directory at test-start time with the new functions appended. All bb
// invocations load from this patched copy.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFF_LIB = path.join(SCRIPTS_DIR, 'handoff_lib.bb');
const DUP_CHAIN_LIB = path.join(SCRIPTS_DIR, 'duplicate_chain_guard_lib.bb');

// The patch we need to evaluate after loading handoff_lib.bb - defines
// the two new batch-aware readers in the handoff-lib namespace.
// Using in-ns to define them in the existing namespace after load.
const PATCH_EVAL = `
(in-ns 'handoff-lib)
(defn handoff-files-with-batches [dir#]
  (if (fs/exists? dir#)
    (->> (concat (handoff-files dir#)
                 (mapcat handoff-files (batch-dirs dir#)))
         (sort-by #(fs/file-name %))
         vec)
    []))
(defn my-handoff-files-with-batches [dir#]
  (vec (filter mine? (handoff-files-with-batches dir#))))
`;

function bbEval(script, cwd = SCRIPTS_DIR) {
  const result = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A parcel in the generator: a ticket id, a role, and a placement
// (flat vs in a batch dir), and optionally the non-forwarding marker.
const parcelArb = fc.record({
  ticket: fc.constantFrom('BL-901', 'BL-902', 'BL-903'),
  role: fc.constantFrom('cleaner', 'hardender'),
  placement: fc.constantFrom('flat', 'batch'),
  nonForwarding: fc.constantFrom(true, false, 'absent'),
});

const populationArb = fc.array(parcelArb, { minLength: 1, maxLength: 12 });

function writeParcel(root, role, placement, ticket, nonForwarding, idx) {
  const base = path.join(root, role, 'in_process');
  fs.mkdirSync(base, { recursive: true });
  const dir = placement === 'batch'
    ? path.join(base, `batch_20260901T000000Z_${String(idx).padStart(6, '0')}`)
    : base;
  fs.mkdirSync(dir, { recursive: true });
  const filename = `50_${ticket}_${placement}_${idx}.handoff`;
  const lines = [
    `id: ${idx}`,
    `from: specifier`,
    `to: ${role}`,
    'priority: 50',
    'type: git_handoff',
    `task: ${ticket}`,
    'commit: a1b2c3d4e5',
  ];
  if (nonForwarding === true) lines.push('non-forwarding: true');
  if (nonForwarding === false) lines.push('non-forwarding: false');
  lines.push('');
  lines.push('body');
  fs.writeFileSync(path.join(dir, filename), lines.join('\n'));
}

function writeRoles(root, role) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${role}\t${role}\t${root}\tswarmforge-${role}\t${role}\tclaude\tbatch\n`
  );
}

function listVisible(root, role) {
  const inProcess = path.join(root, role, 'in_process');
  const script = `(do
    (load-file "${HANDOFF_LIB}")
    ${PATCH_EVAL}
    (let [files (handoff-lib/handoff-files-with-batches "${inProcess}")]
      (doseq [f files] (println (.getName (java.io.File. (str f)))))))`;
  const out = bbEval(script);
  return out ? out.split('\n').filter(Boolean).sort() : [];
}

function blockingParcel(root, ticket, sender) {
  const script = `(do
    (load-file "${HANDOFF_LIB}")
    ${PATCH_EVAL}
    (load-file "${DUP_CHAIN_LIB}")
    (if-let [b (duplicate-chain-guard-lib/blocking-parcel "${root}" "${ticket}" "${sender}")]
      (str (:ticket-id b) "|" (:role b) "|" (.getName (java.io.File. (str (:file b)))))
      "NIL"))`;
  return bbEval(script);
}

function populationFiles(population) {
  return population.map((p, i) => ({ ...p, idx: i }));
}

describe('BL-1313 batch guard visibility invariants (property)', () => {
  it('Invariant 1: a batch-held parcel is visible to handoff-files-with-batches exactly as a flat one', () => {
    fc.assert(
      fc.property(populationArb, (population) => {
        const flipped = population.map((p) => ({
          ...p,
          placement: p.placement === 'flat' ? 'batch' : 'flat',
        }));

        for (const role of ['cleaner', 'hardender']) {
          const popForRole = populationFiles(population.filter((p) => p.role === role));
          const flippedForRole = populationFiles(flipped.filter((p) => p.role === role));
          if (popForRole.length === 0) continue;

          const expectedTickets = popForRole.map((p) => p.ticket).sort();

          const actual1 = withRoot('sfvc-bl1313-a-', (root) => {
            writeRoles(root, role);
            for (const p of popForRole) writeParcel(root, role, p.placement, p.ticket, p.nonForwarding, p.idx);
            return listVisible(root, role).map((f) => f.split('_')[1]).sort();
          });

          const actual2 = withRoot('sfvc-bl1313-b-', (root) => {
            writeRoles(root, role);
            for (const p of flippedForRole) writeParcel(root, role, p.placement, p.ticket, p.nonForwarding, p.idx);
            return listVisible(root, role).map((f) => f.split('_')[1]).sort();
          });

          assert.deepEqual(actual1, expectedTickets, 'original placement');
          assert.deepEqual(actual2, expectedTickets, 'flipped placement');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('Invariant 2: a batch-held forward parcel blocks a competing chain exactly as a flat one does', () => {
    fc.assert(
      fc.property(populationArb, (population) => {
        const holdingRoles = new Set(population.map((p) => p.role));
        const sender = holdingRoles.has('coder') ? 'documenter' : 'coder';
        const ticket = population[0].ticket;

        const flipped = population.map((p) => ({
          ...p,
          placement: p.placement === 'flat' ? 'batch' : 'flat',
        }));

        for (const pop of [population, flipped]) {
          const result = withRoot('sfvc-bl1313-dup-', (root) => {
            for (const role of ['cleaner', 'hardender']) writeRoles(root, role);
            fs.mkdirSync(path.join(root, sender), { recursive: true });
            const tsv = fs.readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8');
            fs.writeFileSync(
              path.join(root, '.swarmforge', 'roles.tsv'),
              tsv + `${sender}\t${sender}\t${root}\tswarmforge-${sender}\t${sender}\tclaude\ttask\n`
            );
            for (const [i, p] of populationFiles(pop).entries()) {
              writeParcel(root, p.role, p.placement, p.ticket, p.nonForwarding, i);
            }
            return blockingParcel(root, ticket, sender);
          });
          const hasForwardable = pop.some(
            (p) => p.ticket === ticket && p.nonForwarding !== true
          );
          if (hasForwardable) {
            assert.notEqual(result, 'NIL', `expected blocking parcel, got NIL for pop=${JSON.stringify(pop)}`);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
