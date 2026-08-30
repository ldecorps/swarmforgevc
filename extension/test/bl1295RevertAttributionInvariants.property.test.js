const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1295 declared invariants:
// 1. A revert commit is attributed to whoever authored the revert, never to
//    the ticket named in the subject it inherited.
// 2. The gate's verdict is unchanged by the presence of a revert that undoes
//    only the task's own earlier merge - a parcel refused with such a revert
//    in range would have been refused without it.
//
// Invariant 1 drives the REAL pure predicate. Invariant 2 builds a REAL git
// repository twice - once with the revert in range and once without,
// identical in every other respect - and compares the REAL gate's verdicts.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');
const TASK = 'BL-1240';
const OWN_PATH = 'extension/src/metrics/bl1240Fixture.ts';
const FOREIGN_PATH = 'docs/how-to/BL-973-bb-fixture-closure-guards-and-suite-inventory.md';

function bbEval(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return result.stdout.trim();
}

// ── invariant 1: the pure attribution rule ─────────────────────────────────

const TICKET_ID = () => fc.integer({ min: 1, max: 9999 }).map((n) => `BL-${n}`);
const PLAIN_SUBJECT = () => TICKET_ID().map((id) => ({ id, subject: `${id}: do the thing` }));

// Every generated pair is a collision CANDIDATE by construction: the revert
// subject is DERIVED from the plain one by the very transformation the gate
// used to conflate, rather than drawn independently. Drawing two subjects
// independently would almost never produce a revert quoting the task's own
// id, which is the only case that can detect the defect.
const SUBJECT_PAIR = () =>
  fc
    .tuple(PLAIN_SUBJECT(), fc.constantFrom('plain', 'revert', 'revert-of-merge', 'revert-of-revert'))
    .map(({ 0: base, 1: kind }) => {
      if (kind === 'plain') return { ...base, kind };
      if (kind === 'revert-of-merge') {
        return { id: base.id, kind, subject: `Revert "Merge documenter ${base.id} 0ca3bc03c0 into QA. By QA."` };
      }
      if (kind === 'revert-of-revert') {
        return { id: base.id, kind, subject: `Revert "Revert \\"${base.subject}\\""` };
      }
      return { id: base.id, kind, subject: `Revert "${base.subject}"` };
    });

function subjectNamesTask(subject, taskId) {
  return (
    bbEval(
      `(load-file ${JSON.stringify(GATE_LIB)}) (print (boolean (task-scope-gate-lib/subject-names-task? ${JSON.stringify(subject)} ${JSON.stringify(taskId)})))`
    ) === 'true'
  );
}

test('property (invariant 1): a revert never claims the ticket its subject merely quotes', () => {
  const seen = { plain: 0, revert: 0, 'revert-of-merge': 0, 'revert-of-revert': 0 };
  fc.assert(
    fc.property(SUBJECT_PAIR(), ({ id, subject, kind }) => {
      seen[kind] += 1;
      const attributed = subjectNamesTask(subject, id);
      assert.equal(
        attributed,
        kind === 'plain',
        `a ${kind} subject was ${attributed ? '' : 'not '}attributed to ${id}: ${subject}`
      );
    }),
    { numRuns: 40 }
  );
  for (const kind of Object.keys(seen)) {
    assert.ok(seen[kind] > 0, `generator never reached ${kind}: ${JSON.stringify(seen)}`);
  }
});

test('property (invariant 1): the word alone is not the signal - only a quoted revert is exempt', () => {
  let cases = 0;
  fc.assert(
    fc.property(TICKET_ID(), (id) => {
      cases += 1;
      // Hand-written subjects that merely mention reverting are the task's
      // own commits and must stay attributed. Exempting too broadly would
      // let genuine foreign scope through, which is the failure direction
      // that matters.
      assert.equal(subjectNamesTask(`${id}: revert the fixture change and redo it`, id), true);
      assert.equal(subjectNamesTask(`${id}: Revert handling for the merge`, id), true);
    }),
    { numRuns: 6 }
  );
  assert.ok(cases > 0);
});

// ── invariant 2: the gate's verdict, over a real repository ────────────────

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
}

function writeCommit(root, filePath, subject) {
  const full = path.join(root, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${subject}\n`);
  git(root, 'add', filePath);
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subject);
  return git(root, 'rev-parse', 'HEAD').trim();
}

// Builds a repo and returns { root, base, tip }. `withRevert` decides only
// whether the revert of the task's own earlier merge is in range; every
// other commit is identical either way, which is what makes the two
// verdicts comparable at all.
function buildRepo(root, { withRevert, foreignCommit }) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@test');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeCommit(root, 'seed.txt', 'seed');

  // The task's own work, on a side branch that is then merged - so there is
  // a merge for the revert to undo. The merge also carries a FOREIGN path,
  // which is what makes reverting it name that path.
  git(root, 'checkout', '-q', '-b', 'work');
  writeCommit(root, OWN_PATH, `${TASK}: the parcel's own work`);
  writeCommit(root, FOREIGN_PATH, 'BL-0973: another ticket carried in the same merge');
  git(root, 'checkout', '-q', 'main');
  git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '-m', `Merge documenter ${TASK} into QA. By QA.`, 'work');
  const mergeSha = git(root, 'rev-parse', 'HEAD').trim();
  // BL-1297: the walk BASE sits just after that merge, so the merge itself is
  // not a candidate. It carries a foreign path deliberately - that is what
  // makes REVERTING it name that path - and since BL-1297 a merge's own
  // first-parent change is no longer invisible to the walk, so leaving the
  // merge in range would refuse every case here and this property could no
  // longer tell the clean parcel from the genuinely foreign one. The REVERT,
  // which is what this ticket is about, stays in range either way.
  const base = mergeSha;

  if (withRevert) {
    git(root, '-c', 'core.hooksPath=/dev/null', 'revert', '--no-edit', '-m', '1', mergeSha);
  }
  if (foreignCommit) {
    // A genuine, non-revert commit whose OWN subject names the task and
    // whose diff touches another ticket's file. This must still be refused.
    writeCommit(root, FOREIGN_PATH, `${TASK}: genuinely reaching into another ticket's file`);
  }
  return { base, tip: git(root, 'rev-parse', 'HEAD').trim() };
}

// The real walk + the real foreign-path decision, through the gate's own
// public seams. Only the handoff-archive base lookup is supplied directly,
// which is not what this ticket changes.
function gateVerdict(root, base, tip) {
  const out = bbEval(`
(load-file ${JSON.stringify(GATE_LIB)})
(let [paths (task-scope-gate-lib/task-tagged-changed-paths ${JSON.stringify(root)} ${JSON.stringify(base)} ${JSON.stringify(tip)} ${JSON.stringify(TASK)})
      findings (task-scope-gate-lib/foreign-scope-findings ${JSON.stringify(TASK)} paths)]
  (print (pr-str {:blocked (task-scope-gate-lib/blocked? {:findings findings})
                  :paths (vec (map :path findings))})))`);
  return { blocked: out.includes(':blocked true'), raw: out };
}

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1295-prop-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('property (invariant 2): a revert of the task\'s own merge never changes the verdict', () => {
  const seen = { clean: 0, genuinelyForeign: 0 };
  fc.assert(
    fc.property(fc.boolean(), (foreignCommit) => {
      seen[foreignCommit ? 'genuinelyForeign' : 'clean'] += 1;
      withRoot((outer) => {
        const withRoot_ = path.join(outer, 'with');
        const withoutRoot = path.join(outer, 'without');
        const a = buildRepo(withRoot_, { withRevert: true, foreignCommit });
        const b = buildRepo(withoutRoot, { withRevert: false, foreignCommit });
        const withVerdict = gateVerdict(withRoot_, a.base, a.tip);
        const withoutVerdict = gateVerdict(withoutRoot, b.base, b.tip);
        assert.equal(
          withVerdict.blocked,
          withoutVerdict.blocked,
          `the revert changed the verdict.\nwith:    ${withVerdict.raw}\nwithout: ${withoutVerdict.raw}`
        );
        // Scenario 02 keeps its teeth: a genuine foreign commit is still
        // refused, and the refusal names the path.
        assert.equal(withVerdict.blocked, foreignCommit, `verdict wrong for foreignCommit=${foreignCommit}: ${withVerdict.raw}`);
        if (foreignCommit) {
          assert.ok(withVerdict.raw.includes(FOREIGN_PATH), `the refusal did not name the foreign path: ${withVerdict.raw}`);
        }
      });
    }),
    { numRuns: 6 }
  );
  assert.ok(seen.clean > 0, 'generator never produced the clean parcel - the case the defect breaks');
  assert.ok(seen.genuinelyForeign > 0, 'generator never produced a genuinely foreign commit - the case that must still refuse');
});
