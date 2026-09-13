'use strict';

// BL-1527 invariant 1: one definition of "blank" for a ticket posing no
// choice, shared by the property test's oracle and its step handler, stated
// once so it can never drift from classifyApprovalRulingRequirement's own
// rule (extension/src/concierge/pendingApprovalReply.ts ~414-432: "Blank is
// not an answer" - the trimmed string is empty). This is the oracle's one
// line; it does not re-implement the classifier beyond that line.
function expectedNoChoiceRulingKind(ruling) {
  return (ruling ?? '').trim() ? 'unknown-option' : 'ok';
}

module.exports = { expectedNoChoiceRulingKind };
