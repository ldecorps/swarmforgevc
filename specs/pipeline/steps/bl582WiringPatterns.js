'use strict';

// BL-1482: the wiring-guard patterns for BL-582's step 05 ("the write is
// committed through the same commit-on-decision path used by expedite
// writes"), extracted from bl582ApprovalTapObservableSteps.js so a
// property test can exercise the exact regexes the step runs, not a
// duplicate that could drift out of sync.
//
// Declared invariant: no pattern here asserts an exact source line - each
// names the symbol (and, for the import, the module it protects) and
// tolerates unrelated tokens/reformatting around it, so an unrelated edit
// to that line cannot turn the scenario red.

// commitApprovalWrites must be imported from util/commitIntegrityRunner,
// whatever else the brace list carries and however it is spaced/ordered.
const COMMIT_APPROVAL_WRITES_IMPORT = /import \{[^}]*\bcommitApprovalWrites\b[^}]*\} from '\.\.\/util\/commitIntegrityRunner'/;

// The plain-approval adapter binds commitApprovalWrites(targetPath,
// backlogId, message) - this call shape is what the scenario claims and
// has no unrelated-token slack to give (BL-1482 left it as-is).
const ADAPTER_BINDING = /commitApprovalWrites: \(backlogId, message\) => commitApprovalWrites\(targetPath, backlogId, message\)/;

// Expedite's commit call must pass targetPath, backlogId as its first two
// args, then (somewhere before its own call closes) compose its message
// via humanDecisionCommitMessage(`Expedite ...`) - not a pinned single
// line, since BL-1475 reshaped this into a multi-line richer-result call
// the same day BL-1482 was minted.
const EXPEDITE_COMMIT_CALL = /commitApprovalWrites\(\s*targetPath,\s*backlogId,[\s\S]*?humanDecisionCommitMessage\(`\s*\bExpedite\b/;

module.exports = { COMMIT_APPROVAL_WRITES_IMPORT, ADAPTER_BINDING, EXPEDITE_COMMIT_CALL };
