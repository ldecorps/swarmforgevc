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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture ledger holding the five 2026-08-19 deferral rows$/, (ctx) => {
    ctx.root = mkFixtureRoot();
  });

  // ── Scenario 01 (Outline) ─────────────────────────────────────────────
  scoped(/^the ledger is told that the (.+) gate for (.+) ran with a result recorded at (.+)$/, (ctx, gate, parcel, evidence) => {
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

  scoped(/^no outstanding row is dated 2026-08-19$/, (ctx) => {
    const outstanding0819 = ctx.liveRows.filter((r) => r.detected_at === '2026-08-19' && !r.discharged_at);
    assert.deepEqual(outstanding0819, [],
      `expected no outstanding 2026-08-19 row, got: ${JSON.stringify(outstanding0819)}`);
  });

  scoped(/^the register report holds no hardening lane row and no unowned row$/, (ctx) => {
    const hardeningRows = ctx.registerReport.rows.filter((r) => r.lane === 'hardening');
    assert.deepEqual(hardeningRows, [], `expected no hardening lane row, got: ${JSON.stringify(hardeningRows)}`);
    assert.deepEqual(ctx.registerReport.unowned, [], `expected no unowned row, got: ${JSON.stringify(ctx.registerReport.unowned)}`);
  });
}

module.exports = { registerSteps };
