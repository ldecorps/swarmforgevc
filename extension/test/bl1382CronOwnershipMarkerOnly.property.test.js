'use strict';

// BL-1382 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. A crontab line carrying no swarmforge marker for this root is
//      byte-preserved by every swarm cron writer for that root - install,
//      uninstall and reconcile - whatever path it names. (Ruling option 1,
//      2026-09-04: this binds every writer.)
//   2. Bash and Babashka decide ownership by ONE rule: the shell predicate and
//      the bb strip agree on a shared corpus, so the two readers can never
//      drift (BL-897).
//
// These drive the REAL readers as subprocesses. A reimplementation of the
// predicate in JavaScript would be a third reader with the same drift problem
// the ticket exists to end.
//
// GENERATOR REACH is constructed: every generated line is built from a root
// and a shape - a marker the swarm writes, or a path under the root that
// carries none - so each case is a genuine owned/unowned decision rather than
// a random string that happens to miss every marker. Both classes are asserted
// reached, and the sibling-root case is derived from the same root string so
// "belongs to R" and "belongs to S" are never accidentally the same question.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'swarmforge_cron_lib.sh');
const RECONCILE = path.join(SCRIPTS, 'reconcile_shift_schedule_crontab.bb');

// Reader 1: the shell predicate, asked line by line.
function shellOwns(line, root) {
  const script = `set -uo pipefail
source ${JSON.stringify(LIB)}
if swarmforge_cron_line_belongs_to_root "$1" "$2"; then echo OWNED; else echo FREE; fi`;
  const r = spawnSync('bash', ['-c', script, 'probe', line, root], { encoding: 'utf8' });
  return `${r.stdout || ''}`.trim() === 'OWNED';
}

// Reader 2: the reconcile strip, asked the same question from the other side -
// it REMOVES what it owns, so a line it keeps is a line it does not own.
function bbOwns(lines, root, probeFile) {
  const r = spawnSync('bb', [probeFile, RECONCILE, root, ...lines], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`the bb strip probe failed: ${r.stdout || ''}${r.stderr || ''}`);
  }
  return `${r.stdout || ''}`.trim().split('\n').filter(Boolean);
}

function writeProbe(dir) {
  const probe = path.join(dir, 'strip_probe.bb');
  fs.writeFileSync(
    probe,
    [
      "(require '[clojure.string :as str])",
      '(let [[script root & lines] *command-line-args*]',
      '  (load-file script)',
      // The fn is private and the script declares its own ns, so reach for the
      // var there rather than copying its body - a copy is the drift itself.
      "  (let [strip (ns-resolve 'reconcile-shift-schedule-crontab 'strip-schedule-lines)",
      '        kept (set (strip (vec lines) root))]',
      '    (doseq [l lines] (when-not (kept l) (println l)))))',
      '',
    ].join('\n'),
  );
  return probe;
}

// A line the swarm itself wrote for `root`, one shape per marker it emits.
const MARKED = [
  (root) => `*/2 * * * * FRESHNESS_ROOT=${root} /bin/sh ${root}/swarmforge/scripts/daemon_log_freshness_check.sh # swarmforge-freshness root=[${root}]`,
  (root) => `0 22 * * 5 ${root}/.swarmforge/operator/night-start.sh # swarmforge-operator-schedule root=[${root}]`,
  (root) => `# swarmforge-shift-schedule-begin ${root}`,
  (root) => `# swarmforge-shift-schedule-end ${root}`,
];

// A line naming `root` that the swarm did NOT write - the human's. Every one
// of these was claimed by the old predicate; the three operator shapes are the
// ones actually lost on 2026-09-04.
const UNMARKED = [
  (root) => `0 9 * * 1-5 ${root}/.swarmforge/operator/day-shift-start.sh`,
  (root) => `30 17 * * 1-5 ${root}/.swarmforge/operator/day-shift-bedtime.sh`,
  (root) => `0 22 * * 5 ${root}/.swarmforge/operator/night-start.sh`,
  (root) => `0 3 * * * ${root}/start-swarm.sh`,
  (root) => `0 4 * * * ${root}/stop-swarm.sh`,
  (root) => `45 16 * * 1-5 ${root}/swarmforge/scripts/wait_for_expedite_then_bedtime.sh ${root}`,
];

const ROOT = fc.stringMatching(/^[a-z][a-z0-9-]{2,10}$/).map((name) => `/fixture/${name}`);

describe('BL-1382 declared invariants', () => {
  it('inv1: an unmarked line naming the root is never the swarm\'s, whatever path it names', () => {
    const reach = { marked: 0, unmarked: 0 };

    fc.assert(
      fc.property(ROOT, fc.nat(), fc.boolean(), (root, pick, wantMarked) => {
        const shapes = wantMarked ? MARKED : UNMARKED;
        const line = shapes[pick % shapes.length](root);
        reach[wantMarked ? 'marked' : 'unmarked'] += 1;

        assert.equal(
          shellOwns(line, root),
          wantMarked,
          `${wantMarked ? 'a marked' : 'an unmarked'} line was classified wrongly: ${line}`,
        );
      }),
      { numRuns: 24 },
    );

    assert.ok(reach.marked > 0 && reach.unmarked > 0, `both classes must be reached: ${JSON.stringify(reach)}`);
  }, 240000);

  it('inv1 (sibling): a line naming another root is never this root\'s, marked or not', () => {
    fc.assert(
      fc.property(ROOT, fc.nat(), fc.boolean(), (root, pick, marked) => {
        // Derived from the same root string, so the two roots share a prefix
        // shape and the test cannot pass by comparing unrelated strings.
        const sibling = `${root}-sibling`;
        const shapes = marked ? MARKED : UNMARKED;
        const line = shapes[pick % shapes.length](sibling);
        assert.equal(shellOwns(line, root), false, `a sibling root's line was claimed: ${line}`);
      }),
      { numRuns: 16 },
    );
  }, 240000);

  it('inv2: the shell predicate and the reconcile strip agree on every generated line', () => {
    const dir = mkTmpDir('bl1382-prop-');
    const probe = writeProbe(dir);
    const reach = { agreedOwned: 0, agreedFree: 0 };

    try {
      fc.assert(
        fc.property(ROOT, fc.array(fc.nat(), { minLength: 2, maxLength: 6 }), fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }), (root, picks, markedFlags) => {
          const lines = picks.map((pick, i) => {
            const shapes = markedFlags[i % markedFlags.length] ? MARKED : UNMARKED;
            return shapes[pick % shapes.length](root);
          });
          const unique = [...new Set(lines)];

          const bbOwned = new Set(bbOwns(unique, root, probe));
          for (const line of unique) {
            const byShell = shellOwns(line, root);
            assert.equal(
              byShell,
              bbOwned.has(line),
              `the readers disagree on: ${line}\n  shell=${byShell} bb=${bbOwned.has(line)}`,
            );
            reach[byShell ? 'agreedOwned' : 'agreedFree'] += 1;
          }
        }),
        { numRuns: 12 },
      );

      assert.ok(
        reach.agreedOwned > 0 && reach.agreedFree > 0,
        `the corpus must reach both verdicts, or agreement is trivial: ${JSON.stringify(reach)}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);
});
