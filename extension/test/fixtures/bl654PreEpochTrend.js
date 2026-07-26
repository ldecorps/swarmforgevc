'use strict';

// BL-654 worked example: a SELF-CONTAINED fixture standing in for BL-635
// invariants[2] ("pre-epoch absence renders unavailable, never zero"),
// shaped after the roundsPerClose defect BL-635's architect send-back #1
// caught by hand. BL-635 itself is parked mid-flight and its real sidecar
// module is not on `main`, so this fixture is deliberately independent of
// it - a daily trend renderer over a series that only started being
// recorded partway through, at `epochIndex`.
//
// `renderDailyTrend` is the correct behavior: a day before the recording
// epoch has no measurement and must render as unavailable (`null`).
// `renderDailyTrendDefective` reproduces the live defect shape: it
// fabricates a `0` for those same pre-epoch days instead, which a naive
// trend chart cannot distinguish from "zero events actually recorded".

function renderDailyTrend(dailyCounts, epochIndex) {
  return dailyCounts.map((count, day) => (day < epochIndex ? null : count));
}

function renderDailyTrendDefective(dailyCounts, epochIndex) {
  return dailyCounts.map((count, day) => (day < epochIndex ? 0 : count));
}

module.exports = { renderDailyTrend, renderDailyTrendDefective };
