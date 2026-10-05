'use strict';

// Hotfix 2026-10-05 (QA note 003816, BL-1925 held): every stamp-off's "no
// decision without a human" check read the LIVE ledger row and required it
// undecided forever. The human's certification of the QA-passed stamp-offs
// (8ce721bc4f, "Certify all QA-passed") then turned them red on main.
//
// BL-848's sweep never writes a decision; only hotfix_ledger_update.bb
// --decide does, at a human's word, and the decision lands as a commit. So a
// decision that HEAD's committed ledger carries is a human's. What a test run
// or a stamp-off parcel must never do is leave a decision that HEAD does not
// carry. uncommittedDecision() returns null when the row is undecided, or
// decided exactly as HEAD's committed ledger records it; otherwise the
// message to fail with.

const { execFileSync } = require('node:child_process');

function ledgerRow(text, commit) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- commit: ${commit}`);
  if (start === -1) return null;
  const end = lines.slice(start + 1).findIndex((l) => /^- commit: /.test(l.trim()));
  return lines.slice(start, end === -1 ? lines.length : start + 1 + end).join('\n');
}

function isDecided(row) {
  return /state:\s*(certified|waived)\b/.test(row)
    || !/human_decision:\s*null/.test(row)
    || !/decided_at:\s*null/.test(row);
}

function decisionFields(row) {
  return row
    .split('\n')
    .filter((l) => /^\s*(state|human_decision|decided_at):/.test(l))
    .map((l) => l.trim())
    .join('\n');
}

function committedLedger(repoRoot) {
  try {
    return execFileSync('git', ['show', 'HEAD:backlog/hotfix-ledger.yaml'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function uncommittedDecision(repoRoot, ledgerText, commit) {
  const row = ledgerRow(ledgerText, commit);
  if (row === null) return `no ledger row for ${commit}`;
  if (!isDecided(row)) return null;
  const committed = committedLedger(repoRoot);
  const committedRow = committed === null ? null : ledgerRow(committed, commit);
  const humanDecided = committedRow !== null
    && /human_decision:\s*(approved|waived)\b/.test(committedRow)
    && !/decided_at:\s*null/.test(committedRow);
  if (humanDecided && decisionFields(committedRow) === decisionFields(row)) return null;
  return `a decision appears on ${commit} that HEAD's committed ledger does not carry as a human's (only --decide, at a human's word, writes one):\n${row}`;
}

module.exports = { ledgerRow, isDecided, uncommittedDecision };
