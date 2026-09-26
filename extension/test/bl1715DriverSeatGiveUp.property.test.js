'use strict';

// BL-1715's two declared invariants.
//
// Invariant 1 ("A parcel a driver seat gives up is worked next by a
// non-driver seat of the same stage, with no deferral to the seat that
// gave up, and that seat never claims the ticket again while it is in the
// stage"): the claim-time decisions it reduces to are pure over the
// filesystem they're handed - has-non-driver-sibling? (roles.tsv) and
// handoff_lib.bb's worked-task-names-in/given-up-task-names-in exclusion
// (the completed-handoff outcome/outcome_seat markers) - exercised here
// across generated populations, never just the acceptance feature's one
// fixed two-seat fixture.
//
// Invariant 2 ("Every parcel a driver seat ends - handed off, given up or
// escalated - leaves exactly one outcome row, and a given-up attempt
// leaves nothing of itself in the local seat's tree"): the outcome-row
// half quantifies over the real dispatch through real git/seat
// subprocesses across three terminal shapes - not a pure module a
// generator can drive; same disposition BL-1697/1698's own invariant 2
// recorded, encoded instead by the acceptance feature's scenarios 01/03/04
// (BL-1715-a-driver-seat-that-fails-a-parcel-hands-it-to-its-stages-claude-seat.feature),
// which run the real driver end to end for handed-off, given-up and
// escalated alike. The tree-revert half IS a pure-enough module
// (revert-to-pre-claim!, over a real throwaway git repo) and is
// property-tested below across randomly generated commit chains (a mix of
// plain commits and merges), not just the acceptance feature's one fixed
// shape.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');
const HANDOFF_LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'handoff_lib.bb');
const FIXTURE_PREFIX = 'bl1715-giveup-';

function bbEval(loadFile, expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${loadFile}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

// ── Invariant 1a: has-non-driver-sibling? ─────────────────────────────────

const agentArb = fc.constantFrom('claude', 'aider', 'grok', 'codex', 'gemini');

// driver-seat? (and therefore has-non-driver-sibling?) is scoped to the
// "coder" stage by construction (driving-roles is the fixed set #{"coder"}
// - out of scope for any other role per the ticket's own text): an
// unrelated stage's row is NEVER driver-capable regardless of its agent,
// so the roster's OWN stage must be "coder" for this property to say
// anything about the real decision - not an arbitrary generated name.
const rosterArb = fc.record({
  stage: fc.constant('coder'),
  otherStage: fc.constant('cleaner'),
  seatCount: fc.integer({ min: 1, max: 4 }),
  agents: fc.array(agentArb, { minLength: 1, maxLength: 4 }),
});

test('invariant 1a: has-non-driver-sibling? is true iff some OTHER seat of the same stage has a non-driver agent, across generated rosters', () => {
  fc.assert(
    fc.property(rosterArb, ({ stage, otherStage, seatCount, agents }) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      try {
        fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
        const seats = [];
        for (let i = 0; i < seatCount; i += 1) {
          const role = i === 0 ? stage : `${stage}@${i + 1}`;
          const agent = agents[i % agents.length];
          seats.push({ role, agent });
        }
        // An unrelated stage's row must never influence the decision.
        seats.push({ role: otherStage, agent: 'claude' });
        const lines = seats.map((s) => [s.role, 'wt', root, 'sess', 'Display', s.agent, 'task'].join('\t'));
        fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n') + '\n');

        const me = seats[0].role;
        const expected = seats
          .slice(1, seatCount)
          .some((s) => s.agent !== 'aider');
        const raw = bbEval(LIB, `(println (local-parcel-driver-lib/has-non-driver-sibling? "${root}" "${me}"))`);
        assert.equal(raw, String(expected), `roster ${JSON.stringify(seats)} me=${me}: expected ${expected}, got ${raw}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 40 }
  );
});

test('non-vacuous: has-non-driver-sibling? is false for a bare single-seat stage (no sibling row at all)', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      ['coder', 'wt', root, 'sess', 'Coder', 'aider', 'task'].join('\t') + '\n'
    );
    const raw = bbEval(LIB, `(println (local-parcel-driver-lib/has-non-driver-sibling? "${root}" "coder"))`);
    assert.equal(raw, 'false', 'expected no sibling to mean no give-up branch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Invariant 1b: the given-up marker excludes from "worked", and is
// seat-specific for the never-again rule ──────────────────────────────────

function writeHandoff(dir, name, { task, outcome, outcomeSeat }) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['type: git_handoff', 'from: specifier', 'to: coder', 'priority: 50', `task: ${task}`, 'commit: abc1234567'];
  if (outcome) lines.push(`outcome: ${outcome}`);
  if (outcomeSeat) lines.push(`outcome_seat: ${outcomeSeat}`);
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n\nmerge_and_process specifier abc1234567\n');
}

const entryArb = fc.record({
  task: fc.constantFrom('BL-1', 'BL-2', 'BL-3'),
  givenUp: fc.boolean(),
  seat: fc.constantFrom('coder', 'coder@2', 'coder@3'),
});

test('invariant 1b: worked-task-names-in never attributes a task whose only completed entry is given-up, whatever the population', () => {
  fc.assert(
    fc.property(fc.array(entryArb, { minLength: 0, maxLength: 6 }), (entries) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      const dir = path.join(root, 'completed');
      try {
        entries.forEach((e, i) => {
          writeHandoff(dir, `50_2026_${i}.handoff`, {
            task: e.task,
            outcome: e.givenUp ? 'given-up' : undefined,
            outcomeSeat: e.givenUp ? e.seat : undefined,
          });
        });
        const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/worked-task-names-in "${dir}"))`);
        const worked = new Set((raw.match(/[A-Za-z0-9-]+/g) || []).filter((s) => s.startsWith('BL-')));
        const tasksWithOnlyGivenUp = new Set(
          ['BL-1', 'BL-2', 'BL-3'].filter((t) => {
            const forTask = entries.filter((e) => e.task === t);
            return forTask.length > 0 && forTask.every((e) => e.givenUp);
          })
        );
        for (const t of tasksWithOnlyGivenUp) {
          assert.ok(!worked.has(t), `expected ${t} (only given-up entries) to be excluded from worked-task-names-in, got ${raw}`);
        }
        const tasksWithNonGivenUp = new Set(entries.filter((e) => !e.givenUp).map((e) => e.task));
        for (const t of tasksWithNonGivenUp) {
          assert.ok(worked.has(t), `expected ${t} (a real completed entry) to be attributed as worked, got ${raw}`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 40 }
  );
});

test('invariant 1b: given-up-task-names-in is seat-specific - a sibling reading the same shared directory sees an empty set', () => {
  fc.assert(
    fc.property(fc.array(entryArb.filter((e) => e.givenUp), { minLength: 1, maxLength: 5 }), (entries) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      const dir = path.join(root, 'completed');
      try {
        entries.forEach((e, i) => writeHandoff(dir, `50_2026_${i}.handoff`, { task: e.task, outcome: 'given-up', outcomeSeat: e.seat }));
        const seatsPresent = new Set(entries.map((e) => e.seat));
        for (const seat of ['coder', 'coder@2', 'coder@3']) {
          const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/given-up-task-names-in "${dir}" "${seat}"))`);
          const got = new Set((raw.match(/[A-Za-z0-9-]+/g) || []).filter((s) => s.startsWith('BL-')));
          const expected = new Set(entries.filter((e) => e.seat === seat).map((e) => e.task));
          assert.deepEqual(got, expected, `seat ${seat}: expected ${[...expected]}, got ${raw} (present seats: ${[...seatsPresent]})`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 30 }
  );
});

test('non-vacuous: worked-task-names-in DOES attribute a plain git_handoff with no outcome header (proves the exclusion is outcome-specific, not "always empty")', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  const dir = path.join(root, 'completed');
  try {
    writeHandoff(dir, '50_2026_0.handoff', { task: 'BL-9' });
    const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/worked-task-names-in "${dir}"))`);
    assert.match(raw, /BL-9/, `expected a plain (non-given-up) completed git_handoff to still be attributed, got: ${raw}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Invariant 2 (tree half): revert-to-pre-claim! ─────────────────────────
// A random chain of commits since pre-claim-head (a mix of plain commits
// and merges of a side branch) - revert-to-pre-claim! must bring the tree
// back to byte-identical content, whatever the chain's shape, without
// EVER using `git reset` (history length only grows).

const stepArb = fc.constantFrom('plain', 'merge');

function makeRepo(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'prop@example.test']);
  git(root, ['config', 'user.name', 'Prop']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
}

test('invariant 2: revert-to-pre-claim! restores the exact pre-claim tree across randomly generated commit chains (plain commits and merges)', () => {
  fc.assert(
    fc.property(fc.array(stepArb, { minLength: 0, maxLength: 5 }), (steps) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      try {
        makeRepo(root);
        const preClaimHead = git(root, ['rev-parse', 'HEAD']).trim();
        const preClaimFiles = fs.readdirSync(root).filter((f) => f !== '.git').sort();

        steps.forEach((step, i) => {
          if (step === 'plain') {
            fs.writeFileSync(path.join(root, `plain-${i}.txt`), `plain ${i}\n`);
            git(root, ['add', '-A']);
            git(root, ['commit', '-q', '-m', `plain ${i}`]);
          } else {
            const branch = `side-${i}`;
            git(root, ['checkout', '-q', '-b', branch]);
            fs.writeFileSync(path.join(root, `side-${i}.txt`), `side ${i}\n`);
            git(root, ['add', '-A']);
            git(root, ['commit', '-q', '-m', `side ${i}`]);
            git(root, ['checkout', '-q', 'main']);
            git(root, ['merge', '-q', '--no-ff', branch, '-m', `merge side ${i}`]);
            git(root, ['branch', '-q', '-D', branch]);
          }
        });

        const historyBefore = git(root, ['rev-list', '--count', 'HEAD']).trim();
        execFileSync('bb', [
          '-e',
          `(load-file "${LIB}") (local-parcel-driver-lib/revert-to-pre-claim! "${root}" "${preClaimHead}")`,
        ]);
        const historyAfter = git(root, ['rev-list', '--count', 'HEAD']).trim();

        const diff = git(root, ['diff', preClaimHead, 'HEAD', '--stat']).trim();
        assert.equal(diff, '', `expected the tree to match pre-claim exactly after revert, steps=${JSON.stringify(steps)}, diff:\n${diff}`);
        const filesAfter = fs.readdirSync(root).filter((f) => f !== '.git').sort();
        assert.deepEqual(filesAfter, preClaimFiles, `expected the exact same file set, steps=${JSON.stringify(steps)}`);
        // Never `git reset`: history only ever grows (revert commits are
        // added, nothing is ever thrown away).
        if (steps.length > 0) {
          assert.ok(
            Number(historyAfter) > Number(historyBefore),
            `expected revert to ADD commits (never reset), before=${historyBefore} after=${historyAfter}`
          );
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 20 }
  );
});

test('non-vacuous: revert-to-pre-claim! is a no-op when HEAD already equals pre-claim-head', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    makeRepo(root);
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    execFileSync('bb', ['-e', `(load-file "${LIB}") (local-parcel-driver-lib/revert-to-pre-claim! "${root}" "${head}")`]);
    assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), head, 'expected no new commit when already at pre-claim head');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
