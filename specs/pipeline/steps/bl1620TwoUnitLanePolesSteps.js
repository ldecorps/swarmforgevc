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

// Scenario 02 (amended 2026-09-18) has no Given step establishing "the
// file" the way scenario 01's Outline does (its own file comes from the
// Examples table via a captured step argument) - it is a separate
// scenario with fresh context, so the one file this ticket still owns is
// named here too, the same "constant, never re-derived" reasoning as
// TICKET above.
const FILE = 'extension/test/telegramFrontDeskBotCli.test.js';

// The register row's new owner (amended 2026-09-18, specifier correction
// on the hardener's spec-gap bounce): the gate reads the file's IN-SUITE
// duration, which the row's stale-under-80%-of-budget premise does not
// survive, so the row is re-owned rather than removed by this ticket.
const REGISTER_OWNER = 'BL-1633';

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

// The IN-SUITE counterpart to readMeasuredDurationsMs above: the one real
// `npm test` run's per-file duration for `file`, recorded beside the three
// solo runs in the same evidence file (qa_e2e_procedure step 2). Never a
// live re-run here, same reasoning as readMeasuredDurationsMs: a real
// wall-clock measurement is load-variable, so the acceptance run reads the
// coder's own recorded evidence rather than re-measuring live.
function readInSuiteMeasuredMs(file) {
  const evidenceDir = path.join(REPO_ROOT, 'backlog', 'evidence');
  const name = fs.readdirSync(evidenceDir).find((f) => /^BL-1620-coder-landed-\d{8}\.md$/.test(f));
  assert.ok(name, `expected a BL-1620-coder-landed-*.md evidence file under ${evidenceDir}`);
  const text = fs.readFileSync(path.join(evidenceDir, name), 'utf8');
  const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\|\\s*${escapedFile}\\s*\\|\\s*([\\d.]+)\\s*s\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`);
  const m = text.match(re);
  assert.ok(m, `expected an in-suite measurement row for ${file} in ${name}`);
  assert.equal(Number(m[3]), 0, 'the recorded in-suite run must show 0 failed tests');
  return Number(m[1]) * 1000;
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

  // -- Scenario 02 (amended 2026-09-18) --------------------------------------
  //
  // The row's owner changed from this ticket to BL-1633 (the gate reads
  // the file's IN-SUITE duration, under which the row does not read
  // stale), so this scenario now checks the row STAYS, re-owned, rather
  // than that it is removed. The file this scenario is about is FILE
  // (above), not derived from a register-row scan the way the old
  // "both files" version had to.

  scoped(/^backlog\/suite-poles\.tsv names the file under BL-1633$/, (ctx) => {
    const currentRegisterText = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'suite-poles.tsv'), 'utf8');
    ctx.bl1620Register = parseRegisterRows(currentRegisterText);
    ctx.bl1620File = ctx.bl1620File || FILE;
    const row = ctx.bl1620Register.find((r) => r.file === ctx.bl1620File);
    assert.ok(row, `expected a backlog/suite-poles.tsv row for ${ctx.bl1620File}`);
    assert.equal(
      row.ticket,
      REGISTER_OWNER,
      `expected ${ctx.bl1620File}'s row owned by ${REGISTER_OWNER}, got ${row.ticket}`
    );
  });

  scoped(/^the parcel's evidence records the file's in-suite duration from one npm test run$/, (ctx) => {
    ctx.bl1620InSuiteMs = readInSuiteMeasuredMs(ctx.bl1620File);
  });

  scoped(/^the per-file budget guard runs with a 7000 ms budget against that duration and the register$/, (ctx) => {
    const openTickets = openTicketIds(path.join(REPO_ROOT, 'backlog'));
    const durations = [{ file: ctx.bl1620File, durationMs: ctx.bl1620InSuiteMs }];
    ctx.bl1620Verdict = checkFileDurationBudget(durations, PER_FILE_DURATION_BUDGET_MS, ctx.bl1620Register, openTickets);
  });

  scoped(/^it reports no new-pole and no unowned-row for the file$/, (ctx) => {
    assert.ok(
      !ctx.bl1620Verdict.offenders.some((o) => o.file === ctx.bl1620File),
      `${ctx.bl1620File} must not be reported as a new-pole`
    );
    assert.ok(
      !ctx.bl1620Verdict.unownedRows.some((r) => r.file === ctx.bl1620File),
      `${ctx.bl1620File} must not be reported as an unowned-row`
    );
  });

  scoped(/^the parcel leaves the row in backlog\/suite-poles\.tsv$/, (ctx) => {
    const postText = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'suite-poles.tsv'), 'utf8');
    const rows = parseRegisterRows(postText);
    assert.ok(
      rows.some((r) => r.file === ctx.bl1620File && r.ticket === REGISTER_OWNER),
      `expected ${ctx.bl1620File}'s row to remain in backlog/suite-poles.tsv, owned by ${REGISTER_OWNER}`
    );
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
