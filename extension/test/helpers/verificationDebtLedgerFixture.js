'use strict';

// BL-1784: the verification-debt ledger row-writer shared by the unit test
// and the property test - mirrors standingRedRegisterFixture.js's own shape
// (hand-write the row file; drive the real reader CLI, never a second
// parser) for BL-1782's own ledger instead of the standing-red register.
const fs = require('node:fs');
const path = require('node:path');

function escapeQuoted(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderRow(row) {
  let text =
    `- category: ${row.category}\n` +
    `  ticket: ${row.ticket}\n` +
    `  role: ${row.role || 'coder'}\n` +
    `  description: "${escapeQuoted(row.description || 'fixture row')}"\n` +
    `  detected_at: ${row.detectedAt || '2026-01-01'}\n`;
  if (row.evidence) {
    text += `  evidence: ${row.evidence}\n`;
  }
  if (row.settle && row.settle.kind === 'discharge') {
    text += `  discharged_at: ${row.settle.on || '2026-01-02'}\n`;
    text += `  discharged_by: ${row.settle.by || 'coder'}\n`;
    text += `  discharged_evidence: ${row.settle.evidence || 'backlog/evidence/fixture.md'}\n`;
  }
  if (row.settle && row.settle.kind === 'waive') {
    text += `  waived_at: ${row.settle.on || '2026-01-02'}\n`;
    text += `  waived_by: ${row.settle.by || 'coder'}\n`;
    text += `  waive_reason: "${escapeQuoted(row.settle.reason || 'fixture waive')}"\n`;
  }
  return text;
}

// Writes `backlog/verification-debt-ledger.yaml` with the given rows (one
// `- category:` entry each, in BL-1782's own vdl/render-ledger shape) under
// `root`. Each row is `{category, ticket, role, description, detectedAt,
// evidence, settle: null | {kind: 'discharge'|'waive', ...}}`.
function writeVerificationDebtLedgerFixture(root, { rows = [] } = {}) {
  const ledgerDir = path.join(root, 'backlog');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const text = rows.map(renderRow).join('');
  fs.writeFileSync(path.join(ledgerDir, 'verification-debt-ledger.yaml'), text);
}

// Mints (or, with owned: false, deliberately does not mint) a ticket under
// backlog/active declaring `verification_category: <category>` at column 0
// - the ONE way a ticket owns a category (BL-1782 invariant 2: prose/notes
// mentions never count).
function mintCategoryOwner(root, { category, ticket, dir = 'active' }) {
  const ticketDir = path.join(root, 'backlog', dir);
  fs.mkdirSync(ticketDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticketDir, `${ticket}-fixture.yaml`),
    `id: ${ticket}\ntitle: fixture owner\nstatus: todo\nverification_category: ${category}\n`
  );
}

function writeThreshold(root, threshold) {
  const confDir = path.join(root, 'swarmforge');
  fs.mkdirSync(confDir, { recursive: true });
  fs.writeFileSync(path.join(confDir, 'swarmforge.conf'), `config verification_debt_threshold ${threshold}\n`);
}

module.exports = { writeVerificationDebtLedgerFixture, mintCategoryOwner, writeThreshold };
