'use strict';

/**
 * BL-999: recorded load measurements that justify per-test budgets in
 * renderBriefingBurndownCli.test.js. A budget is the relation
 * budgetMs >= ceil(worstMs * MARGIN), never merely a present number.
 *
 * Sources (BL-969 / BL-999 ticket field data, 2026-08-20):
 * - no-flags CLI: 50808ms @ load 148; qa_e2e 54991ms @ load ~40-58
 * - fallback sibling: FAILED at 48926ms @ load up to 77
 * - fixture CLI: 13585ms (brushed the 20000ms suite default once)
 */
const SUITE_DEFAULT_MS = 20000;
/** Standard margin over a recorded worst-case run (BL-969 used ~1.6x). */
const MARGIN = 1.6;

const REAL_REPO_MEASUREMENTS = {
  'renderBriefingBurndown falls back to deriving its own history when no snapshot path is given (smoke test against the real repo)':
    { worstMs: 48926 },
  'renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist':
    { worstMs: 48926 },
  'the compiled CLI runs with no flags at all against the real repo (unchanged pre-BL-897 behavior)':
    { worstMs: 54991 },
};

const FIXTURE_DECISIONS = {
  'renderBriefingBurndown uses the shared snapshot records when a fresh one is given, never deriving its own':
    {
      observedMs: 5000,
      marginVsDefault: SUITE_DEFAULT_MS / 5000,
      rationale:
        'Fixture-only path; observed well under suite default in isolation (BL-815/BL-914). Suite default retained deliberately.',
    },
  'the compiled CLI reads --snapshot from argv and reflects the shared snapshot data':
    {
      observedMs: 13585,
      marginVsDefault: SUITE_DEFAULT_MS / 13585,
      rationale:
        'Fixture-fed CLI; measured 13585ms under load 40-80 (BL-999). Suite default 20000ms retains ~1.47x margin — recorded decision, not an omission.',
    },
};

function requiredBudgetMs(worstMs, margin = MARGIN) {
  return Math.ceil(worstMs * margin);
}

function evaluateRealRepoBudgets(classified) {
  const failures = [];
  const budgets = [];
  for (const c of classified.filter((x) => !x.fixture)) {
    const m = REAL_REPO_MEASUREMENTS[c.name];
    if (!m) {
      failures.push(`real-repo test '${c.name}' has no recorded worst-case measurement (BL-999)`);
      continue;
    }
    if (typeof c.timeoutMs !== 'number') {
      failures.push(`real-repo test '${c.name}' has no explicit budget (BL-969/BL-999)`);
      continue;
    }
    const need = requiredBudgetMs(m.worstMs);
    budgets.push(c.timeoutMs);
    if (c.timeoutMs < need) {
      failures.push(
        `real-repo test '${c.name}' budget ${c.timeoutMs}ms is below required ${need}ms ` +
          `(worst recorded ${m.worstMs}ms × ${MARGIN})`
      );
    }
  }
  if (budgets.length >= 2) {
    const first = budgets[0];
    if (budgets.some((b) => b !== first)) {
      failures.push(
        `structurally identical real-repo tests must share one budget (got ${budgets.join(', ')}) (BL-999)`
      );
    }
  }
  return failures;
}

function evaluateFixtureDecisions(classified) {
  const failures = [];
  for (const c of classified.filter((x) => x.fixture)) {
    const d = FIXTURE_DECISIONS[c.name];
    if (!d || !d.rationale || !(d.marginVsDefault > 1)) {
      failures.push(
        `fixture test '${c.name}' has no recorded margin decision against the suite default (BL-999)`
      );
    }
    if (typeof c.timeoutMs === 'number') {
      failures.push(
        `fixture test '${c.name}' carries an explicit override — fixture path should stay on the suite default with a recorded decision (BL-999)`
      );
    }
  }
  return failures;
}

module.exports = {
  SUITE_DEFAULT_MS,
  MARGIN,
  REAL_REPO_MEASUREMENTS,
  FIXTURE_DECISIONS,
  requiredBudgetMs,
  evaluateRealRepoBudgets,
  evaluateFixtureDecisions,
};
