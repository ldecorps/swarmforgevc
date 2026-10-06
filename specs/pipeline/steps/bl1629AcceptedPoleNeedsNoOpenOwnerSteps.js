'use strict';

// BL-1629: step handlers for "An accepted pole needs no open owner, and
// bl968 is one". Drives the REAL compiled check-suite-file-budget.js
// (parseRegisterRows/checkFileDurationBudget/formatBudgetOffenders)
// directly on fixture text/rows (scenarios 01/02 - never a real vitest
// run).
//
// Hardener note (2026-10-06): the feature's own scenario 03 (bl968's row
// carrying the accepted disposition, and its scoped-sweep source check)
// was retired by the specifier's amendment (a88858fab0) once BL-1630
// brought bl968 under budget - its row left the register instead of
// becoming the first accepted one. This left three step handlers with no
// matching Gherkin text (BL-753: an unreachable handler is a potential
// untested-behavior flag until proven otherwise). The claim they checked
// - bl968's own temp roots carry its pid and it never lists the whole
// temp dir - is independently and directly tested in
// bl968StepRegistryMaterializedTreeGuard.test.js itself (the D1 guard,
// BL-1623's sweepStaleTmpDirs), so removed here rather than left dead.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const { parseRegisterRows, checkFileDurationBudget, formatGuardReport } = require(path.join(
  EXTENSION_DIR,
  'out',
  'tools',
  'check-suite-file-budget'
));

const FEATURE = 'BL-1629 An accepted pole needs no open owner, and bl968 is one';
const BUDGET_MS = 7000;
const FILE = 'f.test.js';

// result.offenders is plain BudgetOffender[] (no `kind` field at all -
// 'new-pole' is only a HEADLINE label, never stamped per-entry); every
// other bucket is FileVerdict[], each entry carrying its own `kind`.
function bucketForVerdict(verdict) {
  return { accepted: 'registeredPoles', 'stale-row': 'staleRows', 'unowned-row': 'unownedRows', 'new-pole': 'offenders' }[verdict];
}

function registerRowFor(shape) {
  if (shape === 'an accepted row naming a closed ticket') {
    return { file: FILE, ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 12600, disposition: 'accepted', note: 're-measure: 2026-12-17' };
  }
  if (shape === 'an owned row naming a closed ticket') {
    return { file: FILE, ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 12600, disposition: 'owned', note: '' };
  }
  if (shape === 'no row at all') {
    return null;
  }
  throw new Error(`BL-1629: unknown row shape "${shape}"`);
}

function registerTextFor(shape) {
  if (shape === 'in the five-column form with no disposition') {
    return `${FILE}\tBL-1\t2026-01-01\t9000\tsome note\n`;
  }
  if (shape === 'with the disposition column set to accepted') {
    return `${FILE}\tBL-1\t2026-01-01\t9000\taccepted\tre-measure: 2026-12-17\n`;
  }
  throw new Error(`BL-1629: unknown register shape "${shape}"`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── accepted-pole-needs-no-open-owner-01 ───────────────────────────────
  scoped(/^a pole register row written (.+)$/, (ctx, shape) => {
    ctx.bl1629Text = registerTextFor(shape);
  });

  scoped(/^the register is read$/, (ctx) => {
    ctx.bl1629Rows = parseRegisterRows(ctx.bl1629Text);
  });

  scoped(/^the row's disposition reads (owned|accepted)$/, (ctx, disposition) => {
    assert.equal(ctx.bl1629Rows[0].disposition, disposition);
  });

  // ── accepted-pole-needs-no-open-owner-02 ───────────────────────────────
  scoped(/^a pole register holding (.+) and a measured duration of (\d+) ms against a 7000 ms budget$/, (ctx, row, measured) => {
    const registerRow = registerRowFor(row);
    ctx.bl1629Result = checkFileDurationBudget([{ file: FILE, durationMs: Number(measured) }], BUDGET_MS, registerRow ? [registerRow] : [], new Set());
  });

  scoped(/^the suite file budget verdict is computed$/, () => {
    // Already computed in the Given step above - checkFileDurationBudget
    // is pure, so there is nothing further to do here.
  });

  scoped(/^the verdict for that file is (accepted|stale-row|unowned-row|new-pole)$/, (ctx, verdict) => {
    const bucket = ctx.bl1629Result[bucketForVerdict(verdict)];
    const found = bucket.find((v) => v.file === FILE);
    assert.ok(found, `expected ${FILE} in result.${bucketForVerdict(verdict)}, got: ${JSON.stringify(ctx.bl1629Result)}`);
    if (verdict !== 'new-pole') {
      assert.equal(found.kind, verdict);
    }
  });

  scoped(/^the printed line (.+)$/, (ctx, mentions) => {
    // The REAL printed output - formatGuardReport's info AND failure
    // lines combined, exactly as printGuardReport prints them - never a
    // hand-picked formatter call that would miss which of the two lines
    // (info for accepted/stale-row, failure for new-pole/unowned-row)
    // this verdict's kind actually prints through.
    const { infoLines, failureLines } = formatGuardReport(ctx.bl1629Result);
    const printed = [...infoLines, ...failureLines].join('\n');
    const filePattern = new RegExp(FILE.replace(/\./g, '\\.'));
    if (mentions === 'its rationale and re-measure date') {
      assert.match(printed, /rationale BL-999/);
      assert.match(printed, /re-measure: 2026-12-17/);
    } else if (mentions === 'the file and its ticket') {
      assert.match(printed, filePattern);
      assert.match(printed, /BL-999/);
    } else if (mentions === 'the file') {
      assert.match(printed, filePattern);
    } else {
      throw new Error(`BL-1629: unknown "mentions" clause "${mentions}"`);
    }
  });
}

module.exports = { registerSteps };
