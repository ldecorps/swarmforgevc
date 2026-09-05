'use strict';

// BL-1439: step handlers for "the deferred hardening gates of 2026-08-19
// are run and discharged". Scenarios 01-02 drive the REAL
// hardening_debt_ledger_update.bb CLI (never a reimplementation of
// discharge-debt) against a fixture root holding the five real 08-19
// rows. Scenario 03 is a read-only live-tree read of the parcel's own
// committed ledger and register - justified because they are the
// contract at this commit (the feature's own header).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1439 The deferred hardening gates of 2026-08-19 are run and discharged';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const UPDATE_CLI = path.join(SCRIPTS, 'hardening_debt_ledger_update.bb');
const READ_CLI = path.join(SCRIPTS, 'hardening_debt_ledger_read.bb');
const REGISTER_CLI = path.join(SCRIPTS, 'standing_red_register_cli.bb');

const FIXTURE_LEDGER = `# fixture
- parcel: BL-620
  gate: mutation
  file_set: a.ts,b.ts,c.ts
  reason: "host busy"
  load: "14/17/16"
  detected_at: 2026-08-19
- parcel: BL-955
  gate: mutation
  file_set: d.ts,e.ts,c.ts
  reason: "host busy"
  load: "35/35/28"
  detected_at: 2026-08-19
- parcel: BL-954
  gate: mutation
  file_set: f.ts,g.ts,h.ts
  reason: "host busy"
  load: "20"
  detected_at: 2026-08-19
- parcel: BL-956
  gate: mutation
  file_set: i.ts
  reason: "host busy"
  load: "85"
  detected_at: 2026-08-19
- parcel: BL-956
  gate: gherkin-mutation
  file_set: specs/features/BL-956-x.feature
  reason: "stalled, no verdict"
  load: "96-145"
  detected_at: 2026-08-19
`;

function mkFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1439-fixture-'));
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'hardening-debt-ledger.yaml'), FIXTURE_LEDGER);
  return root;
}

function readLedgerRows(root) {
  return JSON.parse(execFileSync('bb', [READ_CLI, root], { encoding: 'utf8' }));
}

// Pins each Outline row's own <evidence> literal against its (parcel, gate)
// pair (KNOWN_VALUES) - the Then step at "the ledger still holds the row"
// asserts row.discharged_evidence === ctx.evidence, and ctx.evidence is the
// SAME captured value passed to the CLI as input, so that check alone
// round-trips any value unchanged and cannot tell a mutated Examples
// literal from the real one (BL-908/BL-1420's class).
const KNOWN_EVIDENCE = new Map([
  ['BL-620/mutation', 'backlog/evidence/BL-1439-bl620-mutation.md'],
  ['BL-956/gherkin-mutation', 'backlog/evidence/BL-1439-bl956-gherkin-mutation.md'],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture ledger holding the five 2026-08-19 deferral rows$/, (ctx) => {
    ctx.root = mkFixtureRoot();
  });

  // ── Scenario 01 (Outline) ─────────────────────────────────────────────
  scoped(/^the ledger is told that the (.+) gate for (.+) ran with a result recorded at (.+)$/, (ctx, gate, parcel, evidence) => {
    assert.equal(evidence, KNOWN_EVIDENCE.get(`${parcel}/${gate}`),
      `unknown <evidence> "${evidence}" for ${parcel}/${gate}`);
    ctx.gate = gate;
    ctx.parcel = parcel;
    ctx.evidence = evidence;
    ctx.dischargeResult = (() => {
      try {
        const out = execFileSync('bb', [UPDATE_CLI, ctx.root, '--discharge', parcel, gate, '--evidence', evidence, '2026-09-05'],
          { encoding: 'utf8' });
        return { code: 0, out };
      } catch (e) {
        return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
      }
    })();
  });

  scoped(/^the outstanding debt no longer holds that row$/, (ctx) => {
    const rows = readLedgerRows(ctx.root);
    const row = rows.find((r) => r.parcel === ctx.parcel && r.gate === ctx.gate);
    assert.ok(row, `expected to find the row for ${ctx.parcel}/${ctx.gate}`);
    assert.ok(row.discharged_at, 'expected the row to carry discharged_at (excluded from outstanding-debt)');
  });

  scoped(/^the ledger still holds the row, marked discharged with the date and the evidence pointer$/, (ctx) => {
    const rows = readLedgerRows(ctx.root);
    const row = rows.find((r) => r.parcel === ctx.parcel && r.gate === ctx.gate);
    assert.ok(row, 'expected the row to still exist (never deleted)');
    assert.equal(row.discharged_at, '2026-09-05');
    assert.equal(row.discharged_evidence, ctx.evidence);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the ledger is told that a gate ran without an evidence pointer$/, (ctx) => {
    ctx.rowsBefore = readLedgerRows(ctx.root);
    try {
      execFileSync('bb', [UPDATE_CLI, ctx.root, '--discharge', 'BL-620', 'mutation'], { encoding: 'utf8', stdio: 'pipe' });
      ctx.dischargeResult = { code: 0 };
    } catch (e) {
      ctx.dischargeResult = { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  });

  scoped(/^the discharge is refused naming the missing evidence$/, (ctx) => {
    assert.notEqual(ctx.dischargeResult.code, 0, 'expected a nonzero exit for a discharge with no evidence path');
  });

  scoped(/^the outstanding debt is unchanged$/, (ctx) => {
    const rowsAfter = readLedgerRows(ctx.root);
    assert.deepEqual(rowsAfter, ctx.rowsBefore, 'expected the ledger to be byte-for-byte unchanged after a refused discharge');
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the parcel's own hardening-debt ledger and standing-red register are read$/, (ctx) => {
    ctx.liveRows = readLedgerRows(REPO_ROOT);
    ctx.registerReport = JSON.parse(execFileSync('bb', [REGISTER_CLI, REPO_ROOT], { encoding: 'utf8' }));
  });

  scoped(/^every row dated 2026-08-19 is discharged or records an attempt naming its blocker$/, (ctx) => {
    const rows0819 = ctx.liveRows.filter((r) => r.detected_at === '2026-08-19');
    assert.ok(rows0819.length > 0, 'expected at least one 2026-08-19 row (fixture assumption)');
    const neither = rows0819.filter((r) => !r.discharged_at && !r.attempted_blocker);
    assert.deepEqual(neither, [],
      `expected every row to be discharged or carry an attempt naming its blocker, got: ${JSON.stringify(neither)}`);
  });

  scoped(/^every outstanding row has a register row naming BL-1441 and no discharged row has one$/, (ctx) => {
    const hardeningRows = ctx.registerReport.rows.filter((r) => r.lane === 'hardening');
    const outstanding = ctx.liveRows.filter((r) => r.detected_at === '2026-08-19' && !r.discharged_at);
    const discharged = ctx.liveRows.filter((r) => r.detected_at === '2026-08-19' && r.discharged_at);
    for (const row of outstanding) {
      const fileCsv = row.file_set.join(',');
      const registerRow = hardeningRows.find((r) => r.file === fileCsv);
      assert.ok(registerRow, `expected a register row for outstanding ${row.parcel}/${row.gate}, got hardening rows: ${JSON.stringify(hardeningRows)}`);
      assert.equal(registerRow.ticket, 'BL-1441', `expected ${row.parcel}/${row.gate}'s register row to name BL-1441, got: ${registerRow.ticket}`);
    }
    for (const row of discharged) {
      const fileCsv = row.file_set.join(',');
      const registerRow = hardeningRows.find((r) => r.file === fileCsv);
      assert.equal(registerRow, undefined, `expected NO register row for discharged ${row.parcel}/${row.gate}, got: ${JSON.stringify(registerRow)}`);
    }
  });
}

module.exports = { registerSteps };
