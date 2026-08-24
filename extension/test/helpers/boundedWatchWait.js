'use strict';

// BL-933: fs.watch's own event delivery is the one genuinely OS-async step
// in the three tests this helper serves (BL-131) - kept real on purpose,
// never faked. What BL-131 left unbounded is the await itself: on a loaded
// host a late or dropped OS event ran out the whole test lane's 20000ms
// budget and reported a bare Vitest timeout naming only the test. This
// races the same "resolved by the real event" promise against an explicit,
// much shorter deadline, so a missing event fails fast with a message
// naming the event and the path that was being watched.
//
// BL-1008: the deadline base stays 10000ms (quiet-host value) but the
// applied wait follows BL-1007's recorded contention factor, always kept
// strictly below the test's own effective budget so Vitest never wins the race.
const {
  effectiveBudgetMs,
  resolveUnitLaneTimeout,
} = require('../../../specs/pipeline/steps/lib/contentionBudget');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TEST_BUDGET_BASE_MS = 20000;

function describeWatchWaitTimeout(eventLabel, watchedPath, timeoutMs) {
  return `real fs.watch event "${eventLabel}" on ${watchedPath} did not arrive within ${timeoutMs}ms`;
}

/**
 * Contention-scaled deadline: same arithmetic as the unit-lane budget, then
 * clamped strictly below the test's effective budget (invariant 2).
 */
function resolveBoundedWatchDeadlineMs(opts = {}) {
  const baseMs = opts.baseMs ?? DEFAULT_TIMEOUT_MS;
  const testBudgetBaseMs = opts.testBudgetBaseMs ?? DEFAULT_TEST_BUDGET_BASE_MS;
  const factor =
    'factor' in opts ? opts.factor : resolveUnitLaneTimeout(baseMs).factor;
  const scaled = effectiveBudgetMs(baseMs, factor);
  const testBudget = effectiveBudgetMs(testBudgetBaseMs, factor);
  return Math.min(scaled, testBudget - 1);
}

function awaitRealWatchEvent(promise, { eventLabel, watchedPath, timeoutMs, factor } = {}) {
  if (!eventLabel || !watchedPath) {
    throw new Error('awaitRealWatchEvent requires both eventLabel and watchedPath');
  }
  const ms =
    timeoutMs !== undefined
      ? timeoutMs
      : resolveBoundedWatchDeadlineMs(factor === undefined ? {} : { factor });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(describeWatchWaitTimeout(eventLabel, watchedPath, ms)));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

module.exports = {
  awaitRealWatchEvent,
  describeWatchWaitTimeout,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TEST_BUDGET_BASE_MS,
  resolveBoundedWatchDeadlineMs,
};
