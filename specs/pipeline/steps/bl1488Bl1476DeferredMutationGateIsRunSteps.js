'use strict';

// BL-1488: step handlers for "The Stryker mutation gate deferred on
// BL-1476 is run and discharged". Both scenarios read the parcel's OWN
// committed hardening-debt ledger, standing-red register and evidence
// file - a deliberate read-only live-tree read (the feature's own prose:
// "the contract at this commit"), same shape as BL-1439/BL-1441/BL-1468.
// Drives the real bb CLIs (hardening_debt_ledger_read.bb,
// standing_red_register_cli.bb), never a parallel reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1488 The Stryker mutation gate deferred on BL-1476 is run and discharged';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const READ_CLI = path.join(SCRIPTS, 'hardening_debt_ledger_read.bb');
const REGISTER_CLI = path.join(SCRIPTS, 'standing_red_register_cli.bb');

function readLedgerRows() {
  return JSON.parse(execFileSync('bb', [READ_CLI, REPO_ROOT], { encoding: 'utf8' }));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the parcel's own hardening-debt ledger and standing-red register are read for BL-1476$/, (ctx) => {
    ctx.ledgerRows = readLedgerRows();
    ctx.registerReport = JSON.parse(execFileSync('bb', [REGISTER_CLI, REPO_ROOT], { encoding: 'utf8' }));
  });

  scoped(/^the BL-1476 mutation row carries a discharged_at date and a discharged_evidence path$/, (ctx) => {
    const row = ctx.ledgerRows.find((r) => r.parcel === 'BL-1476' && r.gate === 'mutation');
    assert.ok(row, 'expected a ledger row for parcel=BL-1476 gate=mutation');
    assert.ok(row.discharged_at, `expected discharged_at to be set, got: ${JSON.stringify(row)}`);
    assert.ok(row.discharged_evidence, `expected discharged_evidence to be set, got: ${JSON.stringify(row)}`);
    ctx.evidencePath = path.join(REPO_ROOT, row.discharged_evidence);
  });

  scoped(/^the register report holds no hardening lane row naming BL-1488$/, (ctx) => {
    const hardeningRows = ctx.registerReport.rows.filter((r) => r.lane === 'hardening' && r.ticket === 'BL-1488');
    assert.deepEqual(hardeningRows, [], `the register still carries a hardening row naming BL-1488: ${JSON.stringify(hardeningRows)}`);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the discharge evidence for the mutation gate of BL-1476 is read$/, (ctx) => {
    const rows = readLedgerRows();
    const row = rows.find((r) => r.parcel === 'BL-1476' && r.gate === 'mutation');
    assert.ok(row, 'no ledger row found for parcel=BL-1476 gate=mutation');
    assert.ok(row.discharged_evidence, `BL-1476's mutation gate carries no discharge evidence yet (discharged_at=${row.discharged_at})`);
    ctx.evidencePath = path.join(REPO_ROOT, row.discharged_evidence);
    ctx.evidenceText = fs.readFileSync(ctx.evidencePath, 'utf8');
  });

  scoped(
    /^it records a completed Stryker run over transcriptWalker, turnProfileProducer and run-turn-profile-producer with zero surviving mutants or a reason per survivor$/,
    (ctx) => {
      const survivorsMatch = /^Survivors:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
      assert.ok(survivorsMatch, `evidence at ${ctx.evidencePath} has no "Survivors: N" summary line: ${ctx.evidenceText.slice(0, 300)}`);
      const survivorCount = Number(survivorsMatch[1]);
      if (survivorCount === 0) {
        return;
      }
      const reasonLines = (ctx.evidenceText.match(/^- .+$/gm) || []).length;
      assert.ok(
        reasonLines >= survivorCount,
        `evidence declares ${survivorCount} survivor(s) but only ${reasonLines} reason line(s) ("- ...") are present`
      );
    }
  );

  scoped(/^it records the host load and the duration of that run$/, (ctx) => {
    assert.match(ctx.evidenceText, /^Load:\s*\S.+$/m, `evidence at ${ctx.evidencePath} has no "Load: ..." line`);
    assert.match(ctx.evidenceText, /^Duration:\s*\S.+$/m, `evidence at ${ctx.evidencePath} has no "Duration: ..." line`);
  });
}

module.exports = { registerSteps };
