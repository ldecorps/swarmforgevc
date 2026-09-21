'use strict';

// BL-1638: step handlers for "The Stryker mutation gates deferred on
// BL-775 and BL-831 are run and discharged". All four scenarios read the
// parcel's OWN committed hardening-debt ledger, standing-red register and
// evidence files - a deliberate read-only live-tree read (the feature's
// own prose: "the contract at this commit"), same shape as
// BL-1439/BL-1441/BL-1468/BL-1488. Drives the real bb CLIs
// (hardening_debt_ledger_read.bb, standing_red_register_cli.bb), never a
// parallel reimplementation.
//
// Amended 2026-09-21 (specifier adjudication on the coder's spec-gap
// note): scenarios 01/03 assert the register's hardening rows are
// PRESENT and OWNED by BL-1638 at the parcel commit, never absent - a
// parcel never edits backlog/standing-reds.tsv (coder.prompt, BL-1663);
// only QA's land retires a row (BL-1631).
//
// Handler lands in the same parcel as the amended feature (BL-233).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1638 The Stryker mutation gates deferred on BL-775 and BL-831 are run and discharged';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const READ_CLI = path.join(SCRIPTS, 'hardening_debt_ledger_read.bb');
const REGISTER_CLI = path.join(SCRIPTS, 'standing_red_register_cli.bb');

const FILE_SETS = {
  'BL-775': ['extension/out/bridge/bubbleLiveUiHtml.js', 'extension/out/bridge/residentPaneLive.js'],
  'BL-831': ['extension/out/bridge/bubblePipelinePage.js'],
};

function readLedgerRows() {
  return JSON.parse(execFileSync('bb', [READ_CLI, REPO_ROOT], { encoding: 'utf8' }));
}

function readRegisterReport() {
  return JSON.parse(execFileSync('bb', [REGISTER_CLI, REPO_ROOT], { encoding: 'utf8' }));
}

function findRow(ctx, parcel) {
  const row = ctx.ledgerRows.find((r) => r.parcel === parcel && r.gate === 'stryker-mutation');
  assert.ok(row, `expected a ledger row for parcel=${parcel} gate=stryker-mutation`);
  return row;
}

function assertDischarged(ctx, parcel) {
  const row = findRow(ctx, parcel);
  assert.ok(row.discharged_at, `expected discharged_at to be set for ${parcel}, got: ${JSON.stringify(row)}`);
  assert.ok(row.discharged_evidence, `expected discharged_evidence to be set for ${parcel}, got: ${JSON.stringify(row)}`);
  ctx.evidencePath = path.join(REPO_ROOT, row.discharged_evidence);
}

function assertRegisterOwnedForFiles(ctx, parcel) {
  const files = FILE_SETS[parcel];
  // The register's hardening rows are keyed on the ledger's own file_set
  // CSV string, one row per (lane, file_set) pair - not one row per
  // individual file - so a multi-file parcel like BL-775 has ONE row
  // whose :file is the whole comma-joined set, matched here by whether
  // any of the row's own comma-split files intersects the expected set.
  const rows = ctx.registerReport.rows.filter(
    (r) => r.lane === 'hardening' && r.file.split(',').some((f) => files.includes(f))
  );
  assert.ok(rows.length > 0, `expected at least one hardening register row for ${parcel}'s file set (${files.join(', ')}), found none: ${JSON.stringify(ctx.registerReport.rows)}`);
  for (const row of rows) {
    assert.equal(row.ticket, 'BL-1638', `expected the hardening row for ${row.file} to name BL-1638 as owner, got: ${JSON.stringify(row)}`);
    assert.equal(row.owned, true, `expected the hardening row for ${row.file} to read owned=true, got: ${JSON.stringify(row)}`);
  }
  assert.deepEqual(ctx.registerReport.unowned, [], `expected no unowned row in the register report, got: ${JSON.stringify(ctx.registerReport.unowned)}`);
}

function readEvidence(ctx, parcel) {
  const row = findRow(ctx, parcel);
  assert.ok(row.discharged_evidence, `${parcel}'s stryker-mutation gate carries no discharge evidence yet (discharged_at=${row.discharged_at})`);
  ctx.evidencePath = path.join(REPO_ROOT, row.discharged_evidence);
  ctx.evidenceText = fs.readFileSync(ctx.evidencePath, 'utf8');
}

function assertEveryOwnedReason(ctx) {
  const survivorsMatch = /^Survivors:\s*(\S[^\n]*)$/m.exec(ctx.evidenceText);
  assert.ok(survivorsMatch, `evidence at ${ctx.evidencePath} has no "Survivors: ..." summary line: ${ctx.evidenceText.slice(0, 300)}`);
  const survivorsLine = survivorsMatch[1];
  if (/^0\b/.test(survivorsLine) && !/owned by|accepted equivalent/.test(survivorsLine)) {
    return;
  }
  // Non-zero (or mixed) survivors: the line itself, or the body, must name
  // one of the ticket's three sanctioned reasons for every declared
  // survivor - never silence about what happened to them.
  const sanctioned = /killed|accepted equivalent|owned by\s+\S*BL-\d+/i;
  assert.match(
    ctx.evidenceText,
    sanctioned,
    `evidence at ${ctx.evidencePath} declares survivors ("${survivorsLine}") but names none of killed/accepted equivalent/owned by <ticket>`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenarios 01/03: ledger + register ──────────────────────────────
  scoped(/^the parcel's own hardening-debt ledger and standing-red register are read for (BL-775|BL-831)$/, (ctx) => {
    ctx.ledgerRows = readLedgerRows();
    ctx.registerReport = readRegisterReport();
  });

  scoped(/^the (BL-775|BL-831) stryker-mutation row carries a discharged_at date and a discharged_evidence path$/, (ctx, parcel) => {
    assertDischarged(ctx, parcel);
  });

  scoped(
    /^the register report names BL-1638 as the open owner of the hardening lane row for the (BL-775|BL-831) file set and reports no unowned row$/,
    (ctx, parcel) => {
      assertRegisterOwnedForFiles(ctx, parcel);
    }
  );

  // BL-831's Then clause names "the file" (singular), not "file set" -
  // same assertion, different article; matched separately so the
  // Gherkin's own wording for each scenario stays literal.
  scoped(
    /^the register report names BL-1638 as the open owner of the hardening lane row for the BL-831 file and reports no unowned row$/,
    (ctx) => {
      assertRegisterOwnedForFiles(ctx, 'BL-831');
    }
  );

  // ── scenarios 02/04: evidence content ───────────────────────────────
  scoped(/^the discharge evidence for the stryker-mutation gate of (BL-775|BL-831) is read$/, (ctx, parcel) => {
    ctx.ledgerRows = ctx.ledgerRows || readLedgerRows();
    readEvidence(ctx, parcel);
  });

  scoped(
    /^it records a completed Stryker run over bubbleLiveUiHtml and residentPaneLive with zero surviving mutants or, per survivor, killed in this pass, accepted equivalent with its proof, or first-run debt owned by a named ticket$/,
    (ctx) => {
      assertEveryOwnedReason(ctx);
    }
  );

  scoped(
    /^it records a completed Stryker run over bubblePipelinePage with zero surviving mutants or, per survivor, killed in this pass, accepted equivalent with its proof, or first-run debt owned by a named ticket$/,
    (ctx) => {
      assertEveryOwnedReason(ctx);
    }
  );

  scoped(/^it records the host load and the duration of that run$/, (ctx) => {
    assert.match(ctx.evidenceText, /^Load:\s*\S.+$/m, `evidence at ${ctx.evidencePath} has no "Load: ..." line`);
    assert.match(ctx.evidenceText, /^Duration:\s*\S.+$/m, `evidence at ${ctx.evidencePath} has no "Duration: ..." line`);
  });
}

module.exports = { registerSteps };
