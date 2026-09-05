'use strict';

// BL-1206 invariant 2: "A file leaves the standing allowlist only by passing
// under the property lane, never by being deleted from the list while still
// red." Pure: given the allowlist's file set before and after a change, and
// whether each file that left the list actually passed when last measured,
// returns every file whose departure is NOT backed by a recorded pass - the
// shape the invariant forbids. A file that stayed, or that was never on the
// list, is never reported: this only judges departures.
function findSilentRemovals(beforeFiles, afterFiles, passedByFile) {
  const afterSet = new Set(afterFiles);
  return beforeFiles.filter((file) => !afterSet.has(file) && passedByFile[file] !== true);
}

module.exports = { findSilentRemovals };
