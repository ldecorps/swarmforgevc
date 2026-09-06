'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-676 declared invariant (coder-authored per BL-654):
//   "The proposal pass is read-only over backlog/ - it writes only its own
//   report file."
// Runs ONLY via `npm run test:properties`.
//
// Drives the REAL epic_backfill_proposals_report.bb CLI (over
// swarmforge/scripts/epic_backfill_proposals_lib.bb) against a randomly
// generated fixture backlog/ tree - never a reimplementation of the
// classifier. Generator reach: every draw builds a fresh mix of epic
// trackers (random slugs, random milestones) and done tickets (random
// mix of already-tagged, milestone-map-eligible, roster-match-eligible,
// and neither), so both "there is something to propose" and "there is
// nothing to propose" runs are reachable, and the invariant is checked
// against the SAME real script real-world scenarios use, not a synthetic
// stub of it.

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'epic_backfill_proposals_report.bb');

function writeYaml(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function hashAllFiles(root) {
  const out = {};
  const backlogRoot = path.join(root, 'backlog');
  if (!fs.existsSync(backlogRoot)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        out[path.relative(root, abs)] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  };
  walk(backlogRoot);
  return out;
}

const identArb = fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/);
const milestoneArb = fc.integer({ min: 1, max: 9 }).map((n) => `M${n}`);
const ticketIdArb = fc.integer({ min: 1, max: 999999 }).map((n) => `BL-${n}`);
const titleWordsArb = fc.array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 1, maxLength: 4 }).map((ws) => ws.join(' '));

const epicArb = fc.record({ slug: identArb, milestone: milestoneArb, titleWords: titleWordsArb });
const doneTicketArb = fc.record({
  id: ticketIdArb,
  milestone: milestoneArb,
  titleWords: titleWordsArb,
  alreadyTagged: fc.boolean(),
});

const fixtureArb = fc.record({
  epics: fc.uniqueArray(epicArb, { minLength: 0, maxLength: 4, selector: (e) => e.slug }),
  doneTickets: fc.uniqueArray(doneTicketArb, { minLength: 0, maxLength: 6, selector: (t) => t.id }),
});

function buildFixture(root, { epics, doneTickets }) {
  epics.forEach((e, i) => {
    writeYaml(
      root,
      `backlog/paused/BL-9${i}00-epic-${e.slug}.yaml`,
      `id: BL-9${i}00\ntitle: "EPIC - ${e.titleWords}"\nmilestone: ${e.milestone}\ntype: epic\nepic: ${e.slug}\n`
    );
  });
  doneTickets.forEach((t, i) => {
    const epicLine = t.alreadyTagged && epics.length > 0 ? `epic: ${epics[i % epics.length].slug}\n` : '';
    writeYaml(root, `backlog/done/M8/${t.id}-fixture.yaml`, `id: ${t.id}\ntitle: "${t.titleWords}"\nmilestone: ${t.milestone}\n${epicLine}`);
  });
}

test('BL-676 invariant: the proposal pass is read-only over backlog/ - it writes only its own report file', () => {
  fc.assert(
    fc.property(fixtureArb, (fixture) => {
      const root = mkTmpDir('bl676-inv-');
      buildFixture(root, fixture);
      const before = hashAllFiles(root);

      const result = spawnSync('bb', [CLI, root], { encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 0, `expected the report CLI to exit 0, got ${result.status}: ${result.stderr}`);

      const after = hashAllFiles(root);
      for (const [file, hash] of Object.entries(before)) {
        assert.equal(after[file], hash, `expected ${file} to be byte-identical after generating the report, but it changed`);
      }
      const newFiles = Object.keys(after).filter((f) => !(f in before));
      assert.deepEqual(
        newFiles,
        ['backlog/evidence/BL-676-epic-backfill-proposals-report.md'],
        `expected only the report file to be new, got ${JSON.stringify(newFiles)}`
      );
    }),
    { numRuns: 30 }
  );
});
