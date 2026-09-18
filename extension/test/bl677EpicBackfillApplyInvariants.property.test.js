'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

// BL-677 declared invariants (coder-authored per BL-654 / coder.prompt's
// Invariants section - first authorship rests with the coder):
//   1. "The apply never overwrites an existing non-empty epic: value."
//   2. "Every value the apply writes is a type: epic roster id or the
//      documented pre-epic-era sentinel - an unknown value refuses the
//      whole run before any write."
//   3. "Re-running the apply with the same approved mapping writes nothing
//      and commits nothing."
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run per engineering.prompt's
// property-test separation rule.
//
// Drives the REAL epic_backfill_apply.bb CLI (over
// epic_backfill_apply_lib.bb's real apply!, including a REAL
// commit_integrity_lib.bb commit) against a real fixture git repo under
// mkdtemp - never a reimplementation of the refusal/classification logic,
// same posture as bl676EpicBackfillProposalsInvariants.property.test.js
// (the predecessor slice) and bl760DuplicateChainGuard's real-bb-subprocess
// properties. A fresh `git init` fixture carries no hooks (this repo's own
// core.hooksPath is a per-checkout .git/config setting, never inherited by
// a new repo), so no guard chain (and no nested property lane) can fire
// from inside a draw's own real commit.
//
// Non-vacuity, checked by hand before landing (all three invariants below):
//   - Invariant 1: temporarily changed classify-row's first cond clause
//     from `(not (str/blank? current-epic))` to `(and false (not
//     (str/blank? current-epic)))` (never routes to :skip-already-tagged).
//     The never-overwrite property failed on its first draw with a
//     pre-tagged ticket (epic: field changed to the newly-proposed value).
//     Reverting made it pass again.
//   - Invariant 2: temporarily removed the `(seq (unknown-epic-values ...))`
//     clause from refusal's cond (the exact "gate deleted" shape). The
//     refused-before-any-write property failed immediately (the run
//     applied and committed the unknown value instead of refusing).
//     Restoring the clause made it pass again.
//   - Invariant 3: first tried mutating classify-row's :skip-already-tagged
//     case to fire only when the current epic equals the row's OWN
//     proposal (the "overwrite unless it matches" bug classify-row's own
//     doc comment warns against) - this test reuses the identical mapping
//     text for both runs, so current-epic == proposal held on the second
//     run anyway and the mutation went uncaught (a real gap in THAT
//     mutation choice, not in the property). Used invariant 1's own
//     mutation instead (:skip-already-tagged never fires): the re-run
//     property failed immediately - with-epic-line has no "already has an
//     epic: line" guard of its own, so the second run inserted a SECOND
//     epic: line into every already-tagged ticket, changing its content
//     and producing a new commit. Reverting made it pass again.

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'epic_backfill_apply.bb');
const SENTINEL_EPIC = 'pre-epic-era';

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function mkFixture() {
  const root = mkTmpDir('sfvc-bl677-prop-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const base = gitOut(root, ['rev-parse', 'HEAD']);
  return { root, base };
}

// Cheap reset (one `reset --hard` + one `clean -fd`, no re-init) - the
// bl760-established treatment for a property that would otherwise pay a
// fresh git-init's several subprocess spawns on every one of numRuns draws.
function resetFixture(fx) {
  git(fx.root, ['reset', '--hard', fx.base, '-q']);
  git(fx.root, ['clean', '-fdq']);
}

function headSha(root) {
  return gitOut(root, ['rev-parse', 'HEAD']);
}

// Scoped to backlog/ only (mirrors the feature file's own "every backlog
// file is byte-identical to before" wording) - the mapping file this test
// writes lives at the fixture root, outside backlog/, so it never pollutes
// the comparison.
function hashBacklogFiles(root) {
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

function readEpicField(root, relPath) {
  const text = fs.readFileSync(path.join(root, relPath), 'utf8');
  const m = text.match(/^epic:\s*(.*)$/m);
  return m ? m[1].trim() : null;
}

function doneRelPath(id) {
  return path.join('backlog', 'done', 'M8', `${id}-fixture.yaml`);
}

function writeDoneTicket(root, id, milestone, currentEpic) {
  const epicLine = currentEpic ? `epic: ${currentEpic}\n` : '';
  writeFile(root, doneRelPath(id), `id: ${id}\ntitle: "fixture ${id}"\nmilestone: ${milestone}\n${epicLine}`);
}

function writeEpicTracker(root, index, slug, milestone) {
  writeFile(
    root,
    path.join('backlog', 'paused', `BL-9${index}00-epic-${slug}.yaml`),
    `id: BL-9${index}00\ntitle: "EPIC - ${slug}"\nmilestone: ${milestone}\ntype: epic\nepic: ${slug}\n`,
  );
}

function buildMapping(rows) {
  const header = '| id | tier | proposal | evidence |\n| --- | --- | --- | --- |\n';
  const body = rows.map((r) => `| ${r.id} | tier | ${r.proposal} | evidence |`).join('\n');
  return `human_approval: approved\n\n${header}${body}\n`;
}

function runApply(root, mappingText) {
  const mappingPath = path.join(root, '.bl677-mapping.md');
  fs.writeFileSync(mappingPath, mappingText, 'utf8');
  return spawnSync('bb', [CLI, root, mappingPath], { encoding: 'utf8', timeout: 20000 });
}

const identArb = fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/);
const milestoneArb = fc.integer({ min: 1, max: 9 }).map((n) => `M${n}`);
const ticketIdArb = fc.integer({ min: 1, max: 999999 }).map((n) => `BL-${n}`);
const epicArb = fc.record({ slug: identArb, milestone: milestoneArb });

function writeRoster(root, roster) {
  roster.forEach((e, i) => writeEpicTracker(root, i, e.slug, e.milestone));
}

// ── Invariant 1: never overwrites an existing non-empty epic: value ────────
//
// Every pre-tagged ticket's proposal is DERIVED to be a DIFFERENT valid
// value than its current tag (never independently drawn) - the exact
// "propose something different and see if it sticks" shape that would
// silently pass a weaker test where current and proposed just happen to
// coincide. Untagged tickets in the SAME draw get a real proposal too, so
// the property also confirms apply does real work in the same run it
// protects already-tagged tickets in - never vacuously "nothing happens".

test(
  'property (BL-677 invariant 1): a ticket already carrying a non-empty epic keeps it, even when the mapping proposes a different valid value',
  () => {
    const fx = mkFixture();
    fc.assert(
      fc.property(
        fc.uniqueArray(epicArb, { minLength: 1, maxLength: 3, selector: (e) => e.slug }),
        fc.uniqueArray(
          fc.record({
            id: ticketIdArb,
            milestone: milestoneArb,
            preTagged: fc.boolean(),
            currentTagRaw: fc.integer({ min: 0, max: 1000 }),
            proposalOffsetRaw: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 1, maxLength: 5, selector: (t) => t.id },
        ),
        (roster, tickets) => {
          resetFixture(fx);
          const { root } = fx;
          const validValues = [...roster.map((e) => e.slug), SENTINEL_EPIC];
          writeRoster(root, roster);

          const rows = tickets.map((t) => {
            const currentIdx = t.currentTagRaw % validValues.length;
            const currentTag = t.preTagged ? validValues[currentIdx] : null;
            let proposalIdx;
            if (t.preTagged) {
              const offset = 1 + (t.proposalOffsetRaw % (validValues.length - 1));
              proposalIdx = (currentIdx + offset) % validValues.length;
            } else {
              proposalIdx = t.proposalOffsetRaw % validValues.length;
            }
            const proposal = validValues[proposalIdx];
            writeDoneTicket(root, t.id, t.milestone, currentTag);
            return { id: t.id, proposal, currentTag };
          });

          const result = runApply(root, buildMapping(rows));
          assert.equal(result.status, 0, `expected a clean apply, got ${result.status}: ${result.stderr}`);

          for (const row of rows) {
            const after = readEpicField(root, doneRelPath(row.id));
            if (row.currentTag) {
              assert.equal(
                after,
                row.currentTag,
                `invariant 1: ${row.id} carried epic "${row.currentTag}" and the mapping proposed the DIFFERENT value "${row.proposal}" - expected it unchanged, got "${after}"`,
              );
            } else {
              assert.equal(
                after,
                row.proposal,
                `expected the untagged ticket ${row.id} to receive its proposed value "${row.proposal}", got "${after}"`,
              );
            }
          }
        },
      ),
      // Measured basis (2026-09-18, this host): a single apply+real-commit
      // cycle against a 1-ticket fixture ran in ~0.05s wall (bb startup +
      // commit-integrity's lock/add/commit/verify on a hookless fixture
      // repo) with resetFixture's own reset+clean at ~0.002s - two orders
      // of magnitude below bl760's mailbox-only sends, since no chase/
      // wake/inject machinery runs here. 25 draws leaves ample headroom
      // even at 10x that floor under live host contention.
      { numRuns: 25 },
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS,
);

// ── Invariant 2: an unknown epic value anywhere refuses the ENTIRE run
// before any write ──
//
// The unknown value is a fixed constant containing a dash - identArb's
// pattern (`[a-z][a-z0-9]{2,8}`) can never itself produce a dash, and the
// constant is not the sentinel, so it is unknown by construction, never by
// chance exclusion. Its position among the mapping's rows is what varies
// draw to draw (fc.integer index), together with every other row's own
// shape (valid proposal, empty proposal, or absent from the roster
// entirely) - so the generator reaches "unknown row first", "unknown row
// last", and "unknown row alone with no valid rows" alike.

const UNKNOWN_EPIC_VALUE = 'not-a-real-epic-value';

test(
  'property (BL-677 invariant 2): one row with an unknown epic value refuses the whole run, writing and committing nothing',
  () => {
    const fx = mkFixture();
    fc.assert(
      fc.property(
        fc.uniqueArray(epicArb, { minLength: 0, maxLength: 3, selector: (e) => e.slug }),
        fc.uniqueArray(
          fc.record({
            id: ticketIdArb,
            milestone: milestoneArb,
            proposalRaw: fc.integer({ min: 0, max: 1000 }),
            emptyProposal: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5, selector: (t) => t.id },
        ),
        fc.integer({ min: 0, max: 1000 }),
        (roster, tickets, unknownIndexRaw) => {
          resetFixture(fx);
          const { root } = fx;
          const validValues = [...roster.map((e) => e.slug), SENTINEL_EPIC];
          writeRoster(root, roster);

          const unknownIndex = unknownIndexRaw % tickets.length;
          const rows = tickets.map((t, i) => {
            writeDoneTicket(root, t.id, t.milestone, null);
            if (i === unknownIndex) {
              return { id: t.id, proposal: UNKNOWN_EPIC_VALUE };
            }
            if (t.emptyProposal) {
              return { id: t.id, proposal: '' };
            }
            return { id: t.id, proposal: validValues[t.proposalRaw % validValues.length] };
          });

          const before = hashBacklogFiles(root);
          const beforeSha = headSha(root);

          const result = runApply(root, buildMapping(rows));

          assert.notEqual(result.status, 0, `expected the run to be refused (non-zero exit), got 0: ${result.stdout}`);
          assert.match(result.stderr, /REFUSED/);
          assert.match(result.stderr, /unknown-epic/);
          assert.match(result.stderr, new RegExp(UNKNOWN_EPIC_VALUE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

          const after = hashBacklogFiles(root);
          assert.deepEqual(after, before, 'invariant 2: every backlog file must be byte-identical to before on refusal');
          assert.equal(headSha(root), beforeSha, 'invariant 2: refusal must create no commit');
        },
      ),
      { numRuns: 25 },
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS,
);

// ── Invariant 3: re-running with the same approved mapping is a
// commitless no-op ──
//
// Every row gets a real, valid, non-empty proposal against an UNTAGGED
// ticket, so the FIRST run is guaranteed to write and commit something -
// otherwise a "nothing changes" assertion on the second run would be
// vacuously true even for a broken re-run guard. The second run is driven
// from the exact same mapping file content (re-slurped, not regenerated),
// matching the ticket's own "Re-run after success" wording.

test(
  'property (BL-677 invariant 3): re-running the exact same approved mapping after success writes nothing and commits nothing',
  () => {
    const fx = mkFixture();
    fc.assert(
      fc.property(
        fc.uniqueArray(epicArb, { minLength: 1, maxLength: 3, selector: (e) => e.slug }),
        fc.uniqueArray(
          fc.record({
            id: ticketIdArb,
            milestone: milestoneArb,
            proposalRaw: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 1, maxLength: 5, selector: (t) => t.id },
        ),
        (roster, tickets) => {
          resetFixture(fx);
          const { root } = fx;
          const validValues = [...roster.map((e) => e.slug), SENTINEL_EPIC];
          writeRoster(root, roster);

          const rows = tickets.map((t) => {
            writeDoneTicket(root, t.id, t.milestone, null);
            return { id: t.id, proposal: validValues[t.proposalRaw % validValues.length] };
          });
          const mappingText = buildMapping(rows);

          const first = runApply(root, mappingText);
          assert.equal(first.status, 0, `expected the first apply to succeed, got ${first.status}: ${first.stderr}`);
          assert.match(first.stdout, /applied (?!0\b)\d+/, 'expected the first run to have actually applied at least one write');

          const afterFirstHashes = hashBacklogFiles(root);
          const afterFirstSha = headSha(root);

          const second = runApply(root, mappingText);
          assert.equal(second.status, 0, `expected the re-run to succeed (a no-op, not a refusal), got ${second.status}: ${second.stderr}`);

          assert.deepEqual(
            hashBacklogFiles(root),
            afterFirstHashes,
            'invariant 3: every backlog file must be byte-identical after the re-run',
          );
          assert.equal(headSha(root), afterFirstSha, 'invariant 3: the re-run must create no commit');
        },
      ),
      // Twice the real apply+commit cost per draw versus invariants 1/2
      // (the same measured ~0.05s floor, paid twice) - still far below the
      // shared subprocess-heavy budget even at high multiples under load.
      { numRuns: 20 },
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS,
);
