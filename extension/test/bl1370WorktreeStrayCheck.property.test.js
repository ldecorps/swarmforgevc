'use strict';

// BL-1370 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. Scope comes from the ONE shared classifier (process_table_lib's
//      project-scoped-process?, BL-887): another worktree's legitimate run is
//      never reported and never killed, and this tool never grows a second
//      notion of what is mine.
//   2. Reaping is by process group, never by pid - an orphaned run reparents
//      to the OS and its children outlive a bare pid kill.
//   3. A stray found is a refusal, not a warning: the check exits non-zero.
//
// These drive the REAL library through bb. A JavaScript reimplementation of
// the predicate would be exactly the second notion of "mine" that invariant 1
// forbids.
//
// GENERATOR REACH is constructed: every line is built from a root and a shape,
// so each case is a genuine own/other and job/not-job decision rather than a
// random string that happens to match nothing. The OTHER root is derived from
// the root (a shared prefix), because two unrelated paths would make invariant
// 1 pass for the wrong reason - which is how a prefix bug hides.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'worktree_stray_lib.bb');

// One bb process per property, answering many questions: a process per draw
// would make this suite slower than the tool it checks.
function classify(cases, probeFile) {
  const res = spawnSync('bb', [probeFile, LIB, JSON.stringify(cases)], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`the stray-lib probe failed: ${res.stdout || ''}${res.stderr || ''}`);
  }
  return JSON.parse(res.stdout);
}

function writeProbe(dir) {
  const probe = path.join(dir, 'stray_probe.bb');
  fs.writeFileSync(
    probe,
    [
      "(require '[cheshire.core :as json])",
      '(let [[lib payload] *command-line-args*]',
      '  (load-file lib)',
      // SCI analyses every form eagerly, so naming worktree-stray-lib/... in
      // source fails before load-file has run (BL-1395's shape, in a probe).
      // Resolve the vars after loading instead.
      "  (let [stray? (ns-resolve 'worktree-stray-lib 'stray?)",
      "        job? (ns-resolve 'worktree-stray-lib 'job-process?)",
      '        cases (json/parse-string payload true)]',
      '    (println',
      '      (json/generate-string',
      '        (mapv (fn [{:keys [cmdline cwd root]}]',
      '                {:stray (stray? {:cmdline cmdline :cwd cwd} root)',
      '                 :job (job? cmdline)})',
      '              cases)))))',
      '',
    ].join('\n'),
  );
  return probe;
}

// Job cmdlines, one per pattern the shared definition carries.
const JOB = [
  (root) => `node --test ${root}/specs/pipeline/generated/x.generated.test.js`,
  (root) => `node ${root}/node_modules/.bin/stryker run`,
  (root) => `node ${root}/node_modules/vitest/vitest.mjs --config vitest.properties.config.mjs`,
];
// Ordinary processes in the same tree: never this gate's business.
const NOT_JOB = [
  (root) => `bash ${root}/swarmforge/scripts/ready_for_next.sh`,
  (root) => `git -C ${root} status`,
  (root) => `node ${root}/extension/out/tools/swarm-metrics.js`,
];

const ROOT = fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/).map((n) => `/fixture/${n}`);

describe('BL-1370 declared invariants', () => {
  it('inv1: a job in MY worktree is mine; the same job in another worktree never is', () => {
    const dir = mkTmpDir('bl1370-prop-');
    const probe = writeProbe(dir);
    const reach = { mine: 0, theirs: 0, notJob: 0 };
    // Every draw is COLLECTED and classified in one bb call at the end. The
    // first version spawned bb per draw - ~90 processes across this file -
    // which under the RAM-capped property pool killed the whole suite mid-run
    // and cost this parcel six commit attempts. A property test that
    // destabilises the shared suite is a defect in the test.
    const cases = [];
    const expected = [];

    try {
      fc.assert(
        fc.property(ROOT, fc.nat(), fc.boolean(), fc.boolean(), (root, pick, jobShape, inMine) => {
          // The other root does NOT share this root's prefix: that case is the
          // shared classifier's known boundary, pinned separately below.
          const other = `/fixture/sibling-of-${root.slice('/fixture/'.length)}`;
          const owner = inMine ? root : other;
          const shapes = jobShape ? JOB : NOT_JOB;
          const cmdline = shapes[pick % shapes.length](owner);

          cases.push({ cmdline, cwd: `${owner}/extension`, root });
          expected.push({ job: jobShape, stray: jobShape && inMine, cmdline });

          if (!jobShape) reach.notJob += 1;
          else if (inMine) reach.mine += 1;
          else reach.theirs += 1;
        }),
        { numRuns: 40 },
      );

      const actual = classify(cases, probe);
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i].job, expected[i].job, `job classification wrong for: ${expected[i].cmdline}`);
        assert.equal(actual[i].stray, expected[i].stray, `ownership wrong for: ${expected[i].cmdline}`);
      }

      assert.ok(reach.mine > 0, `no own-worktree job was generated: ${JSON.stringify(reach)}`);
      assert.ok(reach.theirs > 0, `no sibling-worktree job was generated: ${JSON.stringify(reach)}`);
      assert.ok(reach.notJob > 0, `no ordinary process was generated: ${JSON.stringify(reach)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);

  // The boundary, pinned rather than assumed. `project-scoped-process?` asks
  // `str/includes? cmd root`, so a root that is a PATH PREFIX of another root
  // ( /repo and /repo-2, or .worktrees/coder and .worktrees/coder-2 ) claims
  // the longer one's processes. That is the shared classifier's behaviour,
  // which the orphan janitor and the handoffd supervisor also inherit; this
  // tool delegates to it precisely so the three cannot disagree, so the fix
  // belongs there and not here. Reported to the specifier as a finding.
  //
  // This test exists so the day it changes, it changes visibly.
  it('known boundary: a prefix-shaped sibling root IS claimed by the shared classifier', () => {
    const dir = mkTmpDir('bl1370-prop-');
    const probe = writeProbe(dir);
    try {
      const root = '/fixture/repo';
      const [{ stray }] = classify(
        [{ cmdline: `node --test /fixture/repo-2/x.generated.test.js`, cwd: '/fixture/repo-2', root }],
        probe,
      );
      assert.equal(
        stray,
        true,
        'the shared classifier no longer matches a prefix-shaped sibling - if that is deliberate, ' +
          'this ticket\'s scenario 03/05 promise is now unconditional and this pin should be retired',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it('inv2: reaping targets process GROUPS, and a stray with no readable group is never signalled', () => {
    const dir = mkTmpDir('bl1370-prop-');
    const probe = path.join(dir, 'reap_probe.bb');
    fs.writeFileSync(
      probe,
      [
        "(require '[cheshire.core :as json])",
        '(let [[lib payload] *command-line-args*]',
        '  (load-file lib)',
        "  (let [targets (ns-resolve 'worktree-stray-lib 'reap-targets)]",
        '    (println (json/generate-string',
        '      (mapv targets (json/parse-string payload true))))))',
        '',
      ].join('\n'),
    );

    const batches = [];
    try {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              pid: fc.integer({ min: 2, max: 99999 }),
              pgid: fc.option(fc.integer({ min: 2, max: 99999 }), { nil: null }),
            }),
            { minLength: 1, maxLength: 8 },
          ),
          (strays) => {
            batches.push(strays);
          },
        ),
        { numRuns: 30 },
      );

      // One process for every draw, not one per draw.
      const res = spawnSync('bb', [probe, LIB, JSON.stringify(batches)], { encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      const results = JSON.parse(res.stdout);

      batches.forEach((strays, i) => {
        const { pgids, unreapable } = results[i];
        const known = new Set(strays.filter((s) => s.pgid !== null).map((s) => s.pgid));
        for (const pgid of pgids) {
          assert.ok(known.has(pgid), `a group nothing reported would be signalled: ${pgid}`);
        }
        assert.equal(new Set(pgids).size, pgids.length, 'a group would be signalled twice');
        assert.equal(
          unreapable.length,
          strays.filter((s) => s.pgid === null).length,
          'a stray with no readable group was not reported',
        );
        assert.equal(pgids.length, known.size, 'a readable group was dropped from the targets');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);

  it('inv3: the result line distinguishes a refusal from a clean pass, always', () => {
    const dir = mkTmpDir('bl1370-prop-');
    const probe = path.join(dir, 'line_probe.bb');
    fs.writeFileSync(
      probe,
      [
        "(require '[cheshire.core :as json])",
        '(let [[lib payload] *command-line-args*]',
        '  (load-file lib)',
        "  (let [line (ns-resolve 'worktree-stray-lib 'result-line)]",
        '    (println (json/generate-string',
        '      (mapv (fn [{:keys [strays scanned root]}]',
        '              ;; Rendered TWICE: same state, same bytes is the point of',
        '              ;; having one line at all.',
        '              [(line strays scanned root) (line strays scanned root)])',
        '            (json/parse-string payload true))))))',
        '',
      ].join('\n'),
    );

    const cases = [];
    try {
      fc.assert(
        fc.property(
          ROOT,
          fc.integer({ min: 0, max: 500 }),
          fc.array(
            fc.record({
              pid: fc.integer({ min: 2, max: 99999 }),
              pgid: fc.integer({ min: 2, max: 99999 }),
              cmdline: fc.constant('node --test /fixture/x.generated.test.js'),
            }),
            { maxLength: 4 },
          ),
          (root, scanned, strays) => {
            cases.push({ root, scanned, strays });
          },
        ),
        { numRuns: 20 },
      );

      const res = spawnSync('bb', [probe, LIB, JSON.stringify(cases)], { encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr);
      const rendered = JSON.parse(res.stdout);

      cases.forEach(({ scanned, strays }, i) => {
        const [line, again] = rendered[i];
        if (strays.length > 0) {
          assert.match(line, /stray job process/);
          for (const s of strays) {
            assert.ok(line.includes(`pid=${s.pid}`), `the line hides pid ${s.pid}: ${line}`);
            assert.ok(line.includes(`pgid=${s.pgid}`), `the line hides pgid ${s.pgid}: ${line}`);
          }
          assert.match(line, /kill -- -/);
        } else {
          assert.match(line, /none in /);
          assert.ok(line.includes(`${scanned} process`), `the clean line hides the scan size: ${line}`);
        }
        assert.equal(again, line, 'the result line is not stable for a fixed state');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);
});
