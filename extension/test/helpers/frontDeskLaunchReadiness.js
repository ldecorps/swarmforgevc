'use strict';

// BL-1692: pure, shared analysis of "does every front-desk launch site
// wait for the status-file readiness signal before its first report/
// status read" - the ONE real implementation both
// specs/pipeline/steps/bl1692FreshnessTestWaitsForStatusSteps.js and this
// invariant's own property test drive, never each hand-rolling its own
// copy (the stepHandlerRequireCensus.js precedent: a shared helper under
// extension/test/helpers/, required from specs/pipeline/steps/ too).

function findAllIndices(haystack, needle) {
  const indices = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    indices.push(i);
    from = i + needle.length;
  }
  return indices;
}

function firstIndexOfAny(haystack, needles, from) {
  let best = -1;
  for (const needle of needles) {
    const i = haystack.indexOf(needle, from);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

// For every occurrence of launchMarker in source, the launch is "gated"
// when readinessMarker appears strictly before the first occurrence of
// any readMarkers entry that follows it. Returns {launchCount, violations}
// - violations is the subset of launch indices that are NOT gated (no
// readiness marker before the read, or no read at all following launch).
function checkLaunchSitesGated(source, { launchMarker, readinessMarker, readMarkers }) {
  const launchIndices = findAllIndices(source, launchMarker);
  const violations = [];
  for (const launchIdx of launchIndices) {
    const searchFrom = launchIdx + launchMarker.length;
    const readinessIdx = source.indexOf(readinessMarker, searchFrom);
    const firstReadIdx = firstIndexOfAny(source, readMarkers, searchFrom);
    const gated = readinessIdx !== -1 && firstReadIdx !== -1 && readinessIdx < firstReadIdx;
    if (!gated) {
      violations.push({ launchIdx, readinessIdx, firstReadIdx });
    }
  }
  return { launchCount: launchIndices.length, violations };
}

module.exports = { findAllIndices, firstIndexOfAny, checkLaunchSitesGated };
