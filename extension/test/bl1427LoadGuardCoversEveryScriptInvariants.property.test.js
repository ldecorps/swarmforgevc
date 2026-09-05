'use strict';

// BL-1427 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`. Drives the REAL
// check_bb_scripts_load.sh (BL-1395) against real, throwaway git fixture
// trees - never a reimplementation of its probe/loop logic. Shares its
// fixture-building shape with bl1395BbScriptsLoadGuard.property.test.js
// (mkTmpDir, a committed tree, spawnSync on the real shell guard).
//
//   1. "The guard's verdict covers every script it lists: a listed script
//      the probe never reached is a refusal, never a pass, and the pass
//      line's analysed count equals the listed count." P1 randomizes how
//      many loadable filler scripts exist alongside one stdin-reading
//      script and, independently, whether a reader-error script is ALSO
//      present sorted after it - the exact shape that silently vanished
//      under the drained loop this ticket fixes.
//   2. "The probe executes no script's entry point... so a script's
//      runtime behaviour... never decides the verdict." P2 randomizes
//      which of the three entry-call shapes and what arity -main declares,
//      and asserts the guard passes (an arity mismatch under empty args
//      would refuse a healthy script) and a marker -main would have
//      written never appears.
//   3. "Recall is not lowered: every reader error and every analysis
//      failure BL-1395 scenario 01 pins still refuses naming the file, the
//      line and the symbol" EVEN WHEN the defect sits behind an entry
//      call. P3 randomizes the entry-call shape wrapping an undefined-
//      symbol -main and asserts the refusal still names both.
//
// GENERATOR REACH (BL-654): every P1 case with n-broken>0 is a real,
// previously-hidden defect by construction (the broken script always sorts
// after the stdin-reader, the exact ordering that hid it before); every P2
// case is a real would-be-arity-crash by construction when arity>0 (the
// probe hands no args, so a defined-with-args -main that WAS run would
// always throw).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bb_scripts_load.sh');

const NAME = fc.stringMatching(/^[a-z][a-z0-9]{2,6}$/);

function git(cwdArgs) {
  return spawnSync('git', cwdArgs, { encoding: 'utf8' });
}

function withFixture(fn) {
  const work = mkTmpDir('bl1427-prop-');
  try {
    fs.writeFileSync(path.join(work, '.fixture-owner-pid'), `${process.pid}\n`);
    return fn(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function makeTree(work, label, files) {
  const root = path.join(work, label);
  const scripts = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(scripts, name), body);
  }
  const gitc = (...args) => git(['-C', root, ...args]);
  gitc('init', '-q', '-b', 'main');
  gitc('config', 'user.email', 't@t');
  gitc('config', 'user.name', 't');
  gitc('config', 'commit.gpgsign', 'false');
  gitc('add', '-A');
  gitc('commit', '-qm', 'seed');
  return root;
}

function runGuard(root) {
  const r = spawnSync('bash', [GUARD, root], {
    encoding: 'utf8',
    env: { ...process.env, BB_LOAD_TIMEOUT: '60', BB_BOOT_TIMEOUT: '90' },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

describe('BL-1427 declared invariants', () => {
  it('P1: the guard\'s analysed count equals the listed count, and a defect sorted after a stdin-reading script never hides', () => {
    fc.assert(
      fc.property(
        NAME,
        fc.integer({ min: 0, max: 4 }),
        fc.boolean(),
        (sfx, nFiller, hasBrokenAfter) => {
          withFixture((work) => {
            const files = {
              // "aaa" sorts before any filler/broken name below, so this is
              // always reached FIRST - exactly the position that drained
              // the rest of the list before this ticket's fix.
              [`aaa_stdin_${sfx}.bb`]: `(ns aaa-stdin-${sfx})\n(def _s (slurp *in*))\n`,
            };
            for (let i = 0; i < nFiller; i += 1) {
              files[`mmm_filler_${sfx}_${i}.bb`] = `(ns mmm-filler-${sfx}-${i})\n(def x ${i})\n`;
            }
            const brokenName = `zzz_broken_${sfx}.bb`;
            if (hasBrokenAfter) {
              // "zzz" sorts after everything above.
              files[brokenName] = `(ns zzz-broken-${sfx})\n(defn f${sfx} [] (${sfx}undefined-symbol-here))\n`;
            }

            const root = makeTree(work, `t-${sfx}-${nFiller}-${hasBrokenAfter}`, files);
            const result = runGuard(root);

            if (hasBrokenAfter) {
              assert.notEqual(result.code, 0, `a script sorted after the stdin-reader must still refuse:\n${result.out}`);
              assert.ok(result.out.includes(brokenName), `refusal must name ${brokenName}:\n${result.out}`);
            } else {
              const expectedCount = 1 + nFiller;
              assert.equal(result.code, 0, `an all-healthy tree must pass:\n${result.out}`);
              assert.match(
                result.out,
                new RegExp(`\\b${expectedCount} changed Babashka script\\(s\\) analysed`),
                `expected the pass line to report ${expectedCount} analysed:\n${result.out}`,
              );
            }
          });
        },
      ),
      { numRuns: 30 },
    );
  }, 240000);

  it('P2: no entry-call shape or -main arity is ever executed by the probe', () => {
    const entryShapeArb = fc.constantFrom('apply', 'bare', 'with-args');
    const arityArb = fc.integer({ min: 0, max: 2 });
    fc.assert(
      fc.property(NAME, entryShapeArb, arityArb, (sfx, entryShape, arity) => {
        withFixture((work) => {
          const markerPath = path.join(work, `marker-${sfx}.txt`);
          const params = Array.from({ length: arity }, (_, i) => `a${i}`).join(' ');
          const mainDef = `(defn -main [${params}] (spit ${JSON.stringify(markerPath)} "ran"))\n`;
          const entry =
            entryShape === 'apply'
              ? '(apply -main *command-line-args*)\n'
              : entryShape === 'bare'
                ? '(-main)\n'
                : '(-main *command-line-args*)\n';
          const body = `(ns marker-cli-${sfx})\n${mainDef}${entry}`;

          const root = makeTree(work, `entry-${sfx}-${entryShape}-${arity}`, { [`marker_cli_${sfx}.bb`]: body });
          const result = runGuard(root);

          assert.equal(result.code, 0, `a healthy CLI must pass regardless of its -main's arity, since it is never called:\n${result.out}`);
          assert.equal(fs.existsSync(markerPath), false, `the entry call must never run for shape=${entryShape} arity=${arity}`);
        });
      }),
      { numRuns: 24 },
    );
  }, 240000);

  it('P3: a defect behind any entry-call shape still refuses, naming the file and the symbol', () => {
    const entryShapeArb = fc.constantFrom('apply', 'bare', 'with-args');
    fc.assert(
      fc.property(NAME, entryShapeArb, (sfx, entryShape) => {
        withFixture((work) => {
          const missing = `nope${sfx}here`;
          const mainDef = `(defn -main [& args] (${missing}))\n`;
          const entry =
            entryShape === 'apply'
              ? '(apply -main *command-line-args*)\n'
              : entryShape === 'bare'
                ? '(-main)\n'
                : '(-main *command-line-args*)\n';
          const file = `broken_cli_${sfx}.bb`;
          const body = `(ns broken-cli-${sfx})\n${mainDef}${entry}`;

          const root = makeTree(work, `behind-${sfx}-${entryShape}`, { [file]: body });
          const result = runGuard(root);

          assert.notEqual(result.code, 0, `a defect behind an entry call must still refuse:\n${result.out}`);
          assert.ok(result.out.includes(file), `refusal must name the file:\n${result.out}`);
          assert.ok(result.out.includes(missing), `refusal must name the unresolved symbol:\n${result.out}`);
        });
      }),
      { numRuns: 18 },
    );
  }, 240000);
});
