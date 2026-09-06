'use strict';

// BL-1441: step handlers for "The four hardening gates BL-1439 could not
// run are run and discharged". Both scenarios read the parcel's OWN
// committed hardening-debt ledger, standing-red register and evidence
// files - a deliberate read-only live-tree read (the feature's own prose
// justifies it: "they are the contract at this commit") - never a fixture
// standing in for them. Drives the real bb CLIs
// (hardening_debt_ledger_read.bb, standing_red_register_cli.bb), never a
// parallel reimplementation of their JSON shape.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1441 The four hardening gates BL-1439 could not run are run and discharged';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// Every Examples: column value must be load-bearing (engineering.prompt).
const KNOWN_PARCELS = new Set([
  'BL-620',
  'BL-955',
  'BL-954-a-bounce-verifies-its-own-revert',
  'BL-956-pipeline-board-caption-and-cap-hotfix',
]);

function runBbJson(scriptRel, args) {
  const result = spawnSync('bb', [path.join(REPO_ROOT, scriptRel), ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb ${scriptRel} ${args.join(' ')} failed (rc=${result.status}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function readLedgerRows() {
  return runBbJson('swarmforge/scripts/hardening_debt_ledger_read.bb', ['.']);
}

function registerSteps(registry) {
  // ── scenario 01 ────────────────────────────────────────────────────────
  registry.defineScoped(/^the parcel's own hardening-debt ledger and standing-red register are read$/, (ctx) => {
    ctx.ledgerRows = readLedgerRows();
    ctx.registerReport = runBbJson('swarmforge/scripts/standing_red_register_cli.bb', ['.']);
  }, FEATURE);

  registry.defineScoped(/^no outstanding row is dated 2026-08-19$/, (ctx) => {
    const outstanding = ctx.ledgerRows.filter((r) => r.detected_at === '2026-08-19' && !r.discharged_at);
    assert.deepEqual(
      outstanding,
      [],
      `these 2026-08-19 rows are still outstanding: ${JSON.stringify(outstanding.map((r) => `${r.parcel}/${r.gate}`))}`
    );
  }, FEATURE);

  registry.defineScoped(/^the register report holds no hardening lane row$/, (ctx) => {
    const hardeningRows = ctx.registerReport.rows.filter((r) => r.lane === 'hardening');
    assert.deepEqual(hardeningRows, [], `the register still carries hardening rows: ${JSON.stringify(hardeningRows)}`);
  }, FEATURE);

  // ── scenario 02 ────────────────────────────────────────────────────────
  registry.defineScoped(/^the discharge evidence for the mutation gate of (\S+) is read$/, (ctx, parcel) => {
    assert.ok(KNOWN_PARCELS.has(parcel), `unknown parcel example value: ${parcel}`);
    ctx.parcel = parcel;
    const rows = readLedgerRows();
    const row = rows.find((r) => r.parcel === parcel && r.gate === 'mutation');
    assert.ok(row, `no ledger row found for parcel=${parcel} gate=mutation`);
    assert.ok(
      row.discharged_evidence,
      `parcel ${parcel}'s mutation gate carries no discharge evidence yet (discharged_at=${row.discharged_at}, attempted_blocker=${row.attempted_blocker})`
    );
    ctx.evidencePath = path.join(REPO_ROOT, row.discharged_evidence);
    ctx.evidenceText = fs.readFileSync(ctx.evidencePath, 'utf8');
  }, FEATURE);

  registry.defineScoped(/^it records a completed run with zero surviving mutants or a reason per survivor$/, (ctx) => {
    const survivorsMatch = /^Survivors:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
    assert.ok(survivorsMatch, `evidence for ${ctx.parcel} (${ctx.evidencePath}) has no "Survivors: N" summary line: ${ctx.evidenceText.slice(0, 300)}`);
    const survivorCount = Number(survivorsMatch[1]);
    if (survivorCount === 0) {
      return;
    }
    const reasonLines = (ctx.evidenceText.match(/^- .+$/gm) || []).length;
    assert.ok(
      reasonLines >= survivorCount,
      `evidence for ${ctx.parcel} declares ${survivorCount} survivor(s) but only ${reasonLines} reason line(s) ("- ...") are present`
    );
  }, FEATURE);
}

module.exports = { registerSteps };
