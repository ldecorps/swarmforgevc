const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1300 declared invariant:
//
//   "Exactly one number is enforceable as the boot-prefix budget, and it is
//    the number the failing report names."
//
// The defect this encodes: BL-1227 scenario 02's headroom proof measured the
// LIVE tree, so 42000 was enforceable too - and nothing said so. A tree at
// 43000 passed the gate, passed the standing runner, and failed the
// acceptance suite with a report naming 44000. Two enforceable numbers, one
// of them invisible.
//
// Generator reach (coder.prompt): sizes are DERIVED FROM the budget rather
// than drawn independently, so every case is a boundary candidate by
// construction. An independent draw over 5-digit integers would spend nearly
// every run far from the edge, where the property holds trivially - the same
// failure shape as drawing a collision pair independently.

const REPO_ROOT = fs.realpathSync(path.join(__dirname, '..', '..'));
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATE_SH = path.join(SCRIPTS, 'boot_prefix_budget_gate.sh');
const GATE_LIB = path.join(SCRIPTS, 'boot_prefix_budget_gate_lib.bb');
const FIXTURE_PREFIX = 'bl1300-budget-prop-';

// The one number, read from the one place that defines it - a literal here
// would be a second copy and could not fail when the lib drifts.
function budgetFromLib() {
  const m = fs.readFileSync(GATE_LIB, 'utf8').match(/^\(def budget (\d+)\)$/m);
  assert.ok(m, 'boot_prefix_budget_gate_lib.bb must define exactly one budget');
  return Number(m[1]);
}

// The number BL-1227's headroom proof used to enforce in secret. It must not
// be enforceable and must not be named by any verdict.
const RETIRED_CEILING = 42000;

function runGate(root) {
  const result = spawnSync('bash', [GATE_SH, root], { encoding: 'utf8' });
  return { stdout: `${result.stdout || ''}${result.stderr || ''}`.trim(), status: result.status };
}

function parseMeasured(stdout) {
  const m = stdout.match(/ok — (\d+)\/\d+ chars|measured (\d+) chars/);
  assert.ok(m, `could not parse measured size from: ${stdout}`);
  return Number(m[1] || m[2]);
}

// BL-971: sweep leftovers by prefix BEFORE the run too - a killed run traps
// nothing, so the next run collects what it left behind.
function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

// Same calibration technique the BL-1227 step handler uses: an empty-article
// tree, its baseline read from the gate's own output, then padded by the
// remaining delta so the tree lands on an exact size.
function withTreeOfExactSize(targetChars, fn) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    const articlesDir = path.join(root, 'swarmforge', 'constitution', 'articles');
    fs.mkdirSync(articlesDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
    fs.writeFileSync(path.join(root, 'swarmforge', 'PIPELINE.md'), '');
    const articlePath = path.join(articlesDir, '01_article.md');
    fs.writeFileSync(articlePath, '');
    const baseline = parseMeasured(runGate(root).stdout);
    assert.ok(targetChars >= baseline, `target ${targetChars} below empty-tree baseline ${baseline}`);
    fs.writeFileSync(articlePath, 'x'.repeat(targetChars - baseline));
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('exactly one number is enforceable, and every refusal names it', () => {
  sweepFixtures();
  const budget = budgetFromLib();

  fc.assert(
    fc.property(
      // Offsets constructed around the budget itself: the three exact
      // boundary offsets are always drawn, and the wider band still lands
      // inside the 42000..44000 gap where the second, hidden ceiling lived.
      fc.oneof(
        fc.constantFrom(-1, 0, 1),
        fc.integer({ min: -(budget - RETIRED_CEILING) - 500, max: 2000 })
      ),
      (offset) => {
        const size = budget + offset;
        withTreeOfExactSize(size, (root) => {
          const { stdout, status } = runGate(root);

          // One number decides the verdict, and it is `budget`.
          assert.equal(
            status,
            size > budget ? 1 : 0,
            `size ${size} against budget ${budget} exited ${status}: ${stdout}`
          );

          // The report names the number that was actually enforced.
          assert.ok(stdout.includes(String(budget)), `verdict must name the budget: ${stdout}`);
          assert.equal(parseMeasured(stdout), size, `verdict must name the measured size: ${stdout}`);

          // ...and names no other. 42000 was enforceable and unnamed; that
          // is the whole defect.
          if (budget !== RETIRED_CEILING) {
            assert.ok(
              !stdout.includes(String(RETIRED_CEILING)),
              `verdict names a second budget ${RETIRED_CEILING}: ${stdout}`
            );
          }
        });
        return true;
      }
    ),
    { numRuns: 12 }
  );
});

test('the retired 42000 ceiling is not enforceable anywhere in the gap it used to guard', () => {
  sweepFixtures();
  const budget = budgetFromLib();

  fc.assert(
    fc.property(
      // Every draw lands strictly inside 42001..budget - the band that was
      // legal by the documented budget and refused in practice. Derived from
      // both numbers, so no run is wasted outside the gap.
      fc.integer({ min: 1, max: budget - RETIRED_CEILING }),
      (over) => {
        const size = RETIRED_CEILING + over;
        withTreeOfExactSize(size, (root) => {
          const { stdout, status } = runGate(root);
          assert.equal(status, 0, `size ${size} is at or under the ${budget} budget but was refused: ${stdout}`);
        });
        return true;
      }
    ),
    { numRuns: 8 }
  );
});
