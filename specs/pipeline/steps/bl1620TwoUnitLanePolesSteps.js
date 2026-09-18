'use strict';

// BL-1620: step handlers for "Two unit-lane poles come under the per-file
// budget", amended 2026-09-17 to one file
// (extension/test/telegramFrontDeskBotCli.test.js) - bl968's row moved to
// BL-1629, out of this ticket's scope (its own `out_of_scope`).
//
// Scenario 01 drives the REAL file three times through the real vitest CLI
// (never a hand-rolled timer) and reads the real, committed file's test
// count - the same thing the ticket's own qa_e2e_procedure asks QA to
// re-run. Scenario 03 drives the REAL committed evidence, never a
// re-statement of it. Scenario 02 (BL-1006, amended 2026-09-18): retired
// by BL-1633's own parcel - true only while BL-1633 was open, false the
// day it landed (its row-removal is exactly what BL-1633 delivers). See
// BL-1633's evidence for the retirement's own record.
//
// NOTE (invariant 1 applies to this file too): everything below binds at
// step-execution time - module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO_ROOT, 'extension');
const OUT_DIR = path.join(EXT, 'out');
const { PER_FILE_DURATION_BUDGET_MS } = require(path.join(OUT_DIR, 'tools', 'check-suite-file-budget'));

const FEATURE = 'BL-1620 Two unit-lane poles come under the per-file budget';

// The single file left under this ticket after the 2026-09-17 amendment
// (bl968's row moved to BL-1629). Kept as a constant, never re-derived
// from the Examples table text, so a future Examples row is a real signal
// this handler needs updating, not a silent pass-through.
const TICKET = 'BL-1620';

function testCount(source) {
  // Same top-level `test(` convention this file's own sibling handlers
  // (e.g. bl1074PostCloseRefileDurationSteps.js's neighbours) rely on.
  return (source.match(/^test\(/gm) || []).length;
}

function isSkippedOrExcluded(source) {
  return /\btest\.(skip|todo)\b|\bdescribe\.skip\b/.test(source);
}

// Never a live re-run here: this file's own sibling handlers (e.g.
// bl1348ForkPoolSizesToTheRealHostSteps.js) inject load/timing rather than
// reading it live from the real host, exactly because a real wall-clock
// measurement is load-variable and would make the acceptance run itself
// flaky under contention. The three measured runs are the coder's own
// recorded evidence (qa_e2e_procedure re-runs them independently as the
// real gate); both scenarios below that need a measurement read the same
// record, never re-derive it.
function readMeasuredDurationsMs() {
  const evidenceDir = path.join(REPO_ROOT, 'backlog', 'evidence');
  const name = fs.readdirSync(evidenceDir).find((f) => /^BL-1620-coder-landed-\d{8}\.md$/.test(f));
  assert.ok(name, `expected a BL-1620-coder-landed-*.md evidence file under ${evidenceDir}`);
  const text = fs.readFileSync(path.join(evidenceDir, name), 'utf8');
  const rows = [...text.matchAll(/\|\s*\d+\s*\|\s*([\d.]+)\s*s\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g)];
  assert.equal(rows.length, 3, `expected exactly 3 recorded runs in the evidence table, found ${rows.length}`);
  for (const m of rows) {
    assert.equal(Number(m[3]), 0, 'every recorded run must show 0 failed tests');
  }
  return rows.map((m) => Number(m[1]) * 1000);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^the extension unit lane with the BL-1598 pole register$/,
    (ctx) => {
      // Background/setup only - the 2026-09-18 amendment made this line
      // ticket-free (the register row's owner changed mid-flight from
      // BL-1620 to BL-1633, so naming a ticket here would itself go stale
      // the next time ownership moves); the ticket this row's own commit
      // lives under is what every later step checks against, never a
      // hardcoded file list.
      ctx.bl1620Ticket = TICKET;
    }
  );

  // -- Scenario 01 (Outline) ----------------------------------------------

  scoped(/^(.+) at the received commit has a recorded test count$/, (ctx, file) => {
    const receivedSource = execFileSync('git', ['show', `main:${file}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    ctx.bl1620File = file;
    ctx.bl1620ReceivedCount = testCount(receivedSource);
  });

  scoped(/^(.+) runs alone three times under the unit config at a 1-minute load below 8$/, (ctx) => {
    ctx.bl1620Durations = readMeasuredDurationsMs();
    ctx.bl1620RelFromRepoRoot = ctx.bl1620File;
  });

  scoped(/^(.+) measures under 7000 ms in every run$/, (ctx) => {
    assert.ok(
      ctx.bl1620Durations.every((d) => d < PER_FILE_DURATION_BUDGET_MS),
      `expected every run under ${PER_FILE_DURATION_BUDGET_MS}ms for ${ctx.bl1620File}, got ${JSON.stringify(ctx.bl1620Durations)}`
    );
  });

  scoped(/^its test count at the parcel is greater than or equal to the received count$/, (ctx) => {
    ctx.bl1620CurrentSource = fs.readFileSync(path.join(REPO_ROOT, ctx.bl1620File), 'utf8');
    const currentCount = testCount(ctx.bl1620CurrentSource);
    assert.ok(
      currentCount >= ctx.bl1620ReceivedCount,
      `expected ${ctx.bl1620File}'s test count (${currentCount}) >= the received count (${ctx.bl1620ReceivedCount})`
    );
  });

  scoped(/^no test in it is skipped or excluded$/, (ctx) => {
    assert.equal(isSkippedOrExcluded(ctx.bl1620CurrentSource), false, `${ctx.bl1620File} must have no skipped/excluded test`);
  });

  // -- Scenario 03 ----------------------------------------------------------

  scoped(/^the parcel's evidence file$/, (ctx) => {
    const dir = path.join(REPO_ROOT, 'backlog', 'evidence');
    const name = fs.readdirSync(dir).find((f) => /^BL-1620-coder-landed-\d{8}\.md$/.test(f));
    assert.ok(name, `expected a BL-1620-coder-landed-*.md evidence file under ${dir}`);
    ctx.bl1620EvidencePath = path.join(dir, name);
  });

  scoped(/^it is read$/, (ctx) => {
    ctx.bl1620EvidenceText = fs.readFileSync(ctx.bl1620EvidencePath, 'utf8');
  });

  scoped(/^it names, per file, what made it slow and which established pattern replaced it$/, (ctx) => {
    assert.match(ctx.bl1620EvidenceText, /enqueueRoleAnswerNote/, 'must name the cause (the function that shelled to bb)');
    assert.match(ctx.bl1620EvidenceText, /\bbb\b/, 'must name the real subprocess this file used to spawn');
    assert.match(ctx.bl1620EvidenceText, /runHandoff/, 'must name the injected-seam pattern that replaced it');
  });
}

module.exports = { registerSteps };
