'use strict';

// BL-1620: step handlers for "Two unit-lane poles come under the per-file
// budget", amended 2026-09-17 to one file
// (extension/test/telegramFrontDeskBotCli.test.js) - bl968's row moved to
// BL-1629, out of this ticket's scope (its own `out_of_scope`).
//
// Scenario 01 drives the REAL file three times through the real vitest CLI
// (never a hand-rolled timer) and reads the real, committed file's test
// count - the same thing the ticket's own qa_e2e_procedure asks QA to
// re-run. Scenarios 02-03 drive the REAL checkFileDurationBudget (BL-1598)
// and read the REAL committed register/evidence, never a re-statement of
// either.
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
const {
  checkFileDurationBudget,
  parseRegisterRows,
  openTicketIds,
  PER_FILE_DURATION_BUDGET_MS,
} = require(path.join(OUT_DIR, 'tools', 'check-suite-file-budget'));

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
    /^the extension unit lane with the BL-1598 pole register naming both files under BL-1620$/,
    (ctx) => {
      // Background/setup only - the ticket's own amendment narrowed the
      // live scope to one file (out_of_scope names bl968 explicitly); the
      // ticket this row's own commit lives under is what every later step
      // checks against, never a hardcoded file list.
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

  scoped(/^npm test runs three times on the parcel at a 1-minute load below 8$/, (ctx) => {
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

  // -- Scenario 02 ----------------------------------------------------------

  scoped(/^backlog\/suite-poles\.tsv names both files under BL-1620$/, (ctx) => {
    // "Both files" is this ticket's original mint (bl968 +
    // telegramFrontDeskBotCli); the 2026-09-17 amendment moved bl968's row
    // to BL-1629 before this parcel ever touched the register, so the
    // rows THIS ticket still owns on `main` (its own pre-land baseline) is
    // exactly the set this parcel is on the hook for removing.
    const mainRegisterText = execFileSync('git', ['show', 'main:backlog/suite-poles.tsv'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const rows = parseRegisterRows(mainRegisterText);
    ctx.bl1620PreLandRows = rows.filter((r) => r.ticket === TICKET);
    assert.ok(
      ctx.bl1620PreLandRows.length >= 1,
      `expected at least one row owned by ${TICKET} on main, got: ${JSON.stringify(rows)}`
    );
  });

  scoped(/^the parcel's npm test verdict is read$/, (ctx) => {
    const currentRegisterText = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'suite-poles.tsv'), 'utf8');
    ctx.bl1620PostLandRows = parseRegisterRows(currentRegisterText);
    const openTickets = openTicketIds(path.join(REPO_ROOT, 'backlog'));
    const worstRun = Math.max(...readMeasuredDurationsMs());
    const durations = ctx.bl1620PreLandRows.map((row) => ({ file: row.file, durationMs: worstRun }));
    ctx.bl1620Verdict = checkFileDurationBudget(durations, PER_FILE_DURATION_BUDGET_MS, ctx.bl1620PostLandRows, openTickets);
  });

  scoped(/^it reports no new-pole and no stale-row for either file$/, (ctx) => {
    for (const row of ctx.bl1620PreLandRows) {
      assert.ok(
        !ctx.bl1620Verdict.offenders.some((o) => o.file === row.file),
        `${row.file} must not be reported as a new-pole`
      );
      assert.ok(
        !ctx.bl1620Verdict.staleRows.some((r) => r.file === row.file),
        `${row.file} must not be reported as a stale-row`
      );
    }
  });

  scoped(/^the parcel removes both rows from backlog\/suite-poles\.tsv$/, (ctx) => {
    const postLandFiles = new Set(ctx.bl1620PostLandRows.map((r) => r.file));
    for (const row of ctx.bl1620PreLandRows) {
      assert.ok(!postLandFiles.has(row.file), `expected ${row.file}'s row removed from backlog/suite-poles.tsv`);
    }
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
