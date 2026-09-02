const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  estimateCostUsd,
  PRICING_TABLE,
  PRICING_TABLE_VERSION,
  checkPricingCoverage,
  collectReferencedClaudeModels,
  assertPricingCoverage,
} = require('../out/metrics/pricingTable');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1038-EXEMPT: the live read is the assertion. This test collects the
// claude-* models actually referenced by the repo's own conf/packs and asserts
// the pricing table covers every one of them - a pinned copy would freeze the
// model list and let a newly-referenced, unpriced model pass unnoticed, which
// is the single thing this test exists to catch.

const REPO_ROOT = path.join(__dirname, '..', '..');

// BL-100 cost-03 / BL-627: cost derives from a versioned, in-repo pricing table -
// data, not code (a rate update is a one-line PR).

test('the pricing table is versioned and bumped for BL-627', () => {
  assert.equal(typeof PRICING_TABLE_VERSION, 'number');
  assert.ok(PRICING_TABLE_VERSION >= 2, `expected PRICING_TABLE_VERSION >= 2, got ${PRICING_TABLE_VERSION}`);
});

test('BL-627 corrected and newly-added per-MTok rates', () => {
  const expected = {
    'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
    'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
    'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  };
  // BL-1056: these are the LIST rates. claude-sonnet-5 now carries its
  // introductory window, so its list rates are the ones in force after the
  // window closed - resolved for an instant past the boundary rather than
  // read off the row, which is the intro rate by design.
  const postWindow = new Date('2026-09-01T00:00:00.000Z');
  for (const [model, rates] of Object.entries(expected)) {
    assert.ok(PRICING_TABLE[model], `missing PRICING_TABLE entry for ${model}`);
    const inForce = require('../out/metrics/pricingTable').resolveRatesAt(PRICING_TABLE[model], postWindow);
    assert.equal(inForce.inputPerMTok, rates.inputPerMTok, `${model} input`);
    assert.equal(inForce.outputPerMTok, rates.outputPerMTok, `${model} output`);
  }
});

test('estimateCostUsd follows the table\'s per-model input/output rates', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - (rates.inputPerMTok + rates.outputPerMTok)) < 1e-9);
});

test('cache-read tokens are priced at their own (cheaper) rate, not the input rate', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  assert.notEqual(rates.cacheReadPerMTok, rates.inputPerMTok, 'fixture assumption: cache reads are priced differently from fresh input');

  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - rates.cacheReadPerMTok) < 1e-9);
});

test('cache-creation tokens are priced at their own rate', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000, cacheReadTokens: 0 };
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - rates.cacheCreatePerMTok) < 1e-9);
});

test('estimateCostUsd sums all four token categories at their own rates', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const rates = PRICING_TABLE[model];
  const usage = { inputTokens: 500_000, outputTokens: 250_000, cacheCreationTokens: 100_000, cacheReadTokens: 2_000_000 };
  const expected =
    0.5 * rates.inputPerMTok + 0.25 * rates.outputPerMTok + 0.1 * rates.cacheCreatePerMTok + 2 * rates.cacheReadPerMTok;
  const cost = estimateCostUsd(usage, model);
  assert.ok(Math.abs(cost - expected) < 1e-6);
});

test('estimateCostUsd returns null for a model absent from the table, rather than guessing', () => {
  const usage = { inputTokens: 100, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(estimateCostUsd(usage, 'totally-unknown-model'), null);
});

test('estimateCostUsd returns zero for a known model with zero usage', () => {
  const model = Object.keys(PRICING_TABLE)[0];
  const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(estimateCostUsd(usage, model), 0);
});

test('the table includes the models actually observed in this session\'s transcripts', () => {
  assert.ok(PRICING_TABLE['claude-sonnet-5'], 'claude-sonnet-5 must be priced - it is the model this repo runs on');
  assert.ok(PRICING_TABLE['claude-opus-5'], 'claude-opus-5 must be priced - architect/specifier seat');
});

test('BL-627: an unpriced model referenced by a fixture conf fails loud and names it', () => {
  const root = mkTmpDir('bl627-unpriced-');
  try {
    fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      'window coder claude coder --model claude-unpriced-test-model --dangerously-skip-permissions\n'
    );
    assert.equal(PRICING_TABLE['claude-unpriced-test-model'], undefined);
    const result = checkPricingCoverage(root);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('claude-unpriced-test-model'));
    assert.match(result.message, /claude-unpriced-test-model/);
    assert.throws(() => assertPricingCoverage(root), /claude-unpriced-test-model/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BL-627: the current repo roster passes the pricing coverage check', () => {
  const referenced = collectReferencedClaudeModels(REPO_ROOT);
  assert.ok(referenced.length > 0, 'expected at least one claude-* model in conf/packs');
  const result = checkPricingCoverage(REPO_ROOT);
  assert.equal(result.ok, true, result.message);
  assertPricingCoverage(REPO_ROOT);
});

test('BL-740: collectReferencedClaudeModels merges packs, launch, and skips wrong extensions', () => {
  const root = mkTmpDir('bl740-roster-');
  try {
    fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'packs', 'alpha.conf'),
      'window coder claude coder --model claude-pack-alpha --dangerously-skip-permissions\n'
    );
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'packs', 'beta.conf'),
      'coordinator_model claude-pack-beta\n'
    );
    fs.writeFileSync(path.join(root, 'swarmforge', 'packs', 'README.txt'), 'ignore me\n');
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'launch', 'coder.claude-settings.json'),
      '{"model":"claude-launch-coder"}\n'
    );
    fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'notes.txt'), 'ignore me\n');

    const referenced = collectReferencedClaudeModels(root);
    assert.deepEqual(referenced, ['claude-launch-coder', 'claude-pack-alpha', 'claude-pack-beta']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BL-740: collectReferencedClaudeModels still scans packs and launch when swarmforge.conf is absent', () => {
  const root = mkTmpDir('bl740-no-conf-');
  try {
    fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'packs', 'solo.conf'),
      'window qa claude qa --model claude-pack-solo --dangerously-skip-permissions\n'
    );
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'launch', 'qa.claude-settings.json'),
      '{"model":"claude-launch-qa"}\n'
    );

    assert.deepEqual(collectReferencedClaudeModels(root), ['claude-launch-qa', 'claude-pack-solo']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── BL-1056: a price with an expiry date ────────────────────────────────
// A rate that is only valid until a date is expressed IN the table (never a
// sibling file), and the cliff is answerable instead of remembered.

const {
  resolveRatesAt,
  estimateCostUsdAt,
  listPricingWindowAlerts,
  SONNET_5_INTRO_WINDOW_END,
} = require('../out/metrics/pricingTable');

const ONE_INPUT_MTOK = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
const at = (day) => new Date(`${day}T12:00:00.000Z`);

const WINDOWED_TABLE = {
  'claude-sonnet-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheCreatePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    until: '2026-08-31',
    then: { inputPerMTok: 3, outputPerMTok: 15, cacheCreatePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheCreatePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'expires-entirely': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheCreatePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    until: '2026-08-31',
    then: null,
  },
};

test('a windowed rate resolves to the rate whose window contains the instant', () => {
  for (const [day, expected] of [
    ['2026-08-22', 2],
    ['2026-08-31', 2],
    ['2026-09-01', 3],
  ]) {
    assert.equal(estimateCostUsdAt(ONE_INPUT_MTOK, 'claude-sonnet-5', at(day), WINDOWED_TABLE), expected, day);
  }
});

test('the boundary day is inside the window it names, not after it', () => {
  assert.equal(resolveRatesAt(WINDOWED_TABLE['claude-sonnet-5'], at('2026-08-31')).inputPerMTok, 2);
  assert.equal(resolveRatesAt(WINDOWED_TABLE['claude-sonnet-5'], new Date('2026-08-31T23:59:59.999Z')).inputPerMTok, 2);
  assert.equal(resolveRatesAt(WINDOWED_TABLE['claude-sonnet-5'], new Date('2026-09-01T00:00:00.000Z')).inputPerMTok, 3);
});

test('a windowless model costs identically at every instant', () => {
  for (const day of ['2026-08-22', '2026-09-01']) {
    assert.equal(estimateCostUsdAt(ONE_INPUT_MTOK, 'claude-opus-5', at(day), WINDOWED_TABLE), 5, day);
  }
});

test('an instant no window covers is null, the same fail-loud as an unpriced model', () => {
  assert.equal(estimateCostUsdAt(ONE_INPUT_MTOK, 'expires-entirely', at('2026-09-01'), WINDOWED_TABLE), null);
  assert.equal(estimateCostUsdAt(ONE_INPUT_MTOK, 'expires-entirely', at('2026-08-22'), WINDOWED_TABLE), 2);
  assert.equal(estimateCostUsdAt(ONE_INPUT_MTOK, 'unpriced-model', at('2026-08-22'), WINDOWED_TABLE), null);
});

test('estimateCostUsd without an instant costs at the given clock, defaulting to now', () => {
  assert.equal(estimateCostUsd(ONE_INPUT_MTOK, 'claude-sonnet-5', at('2026-08-22'), WINDOWED_TABLE), 2);
  assert.equal(
    estimateCostUsd(ONE_INPUT_MTOK, 'claude-sonnet-5'),
    estimateCostUsdAt(ONE_INPUT_MTOK, 'claude-sonnet-5', new Date(), PRICING_TABLE)
  );
});

test('the staleness query names a closed window with its boundary date', () => {
  const alerts = listPricingWindowAlerts(at('2026-09-01'), WINDOWED_TABLE);
  const sonnet = alerts.find((a) => a.model === 'claude-sonnet-5');
  assert.ok(sonnet, `expected claude-sonnet-5 among ${JSON.stringify(alerts)}`);
  assert.equal(sonnet.status, 'closed');
  assert.equal(sonnet.until, '2026-08-31');
});

test('the staleness query names a window that is about to close', () => {
  const alerts = listPricingWindowAlerts(at('2026-08-22'), WINDOWED_TABLE);
  const sonnet = alerts.find((a) => a.model === 'claude-sonnet-5');
  assert.ok(sonnet, 'expected the closing window to be named before it closes');
  assert.equal(sonnet.status, 'closing');
});

test('the staleness query is silent about a windowless model, and about a window still far off', () => {
  for (const day of ['2026-09-01', '2026-08-22']) {
    assert.equal(
      listPricingWindowAlerts(at(day), WINDOWED_TABLE).some((a) => a.model === 'claude-opus-5'),
      false,
      day
    );
  }
  assert.deepEqual(listPricingWindowAlerts(at('2026-01-01'), WINDOWED_TABLE), []);
});

// The exact instant a window closes (daysRemaining === 0, PRICING_WINDOW_ALERT_DAYS
// boundary at exactly 30) - pinning the current, intentional side each
// comparison falls on rather than leaving the boundary untested.
test('the staleness query at the exact daysRemaining=0 and =30 boundaries', () => {
  // endOfWindow('2026-08-31') is 2026-09-01T00:00:00.000Z: asking at that
  // exact instant gives daysRemaining === 0, which is NOT < 0, so the window
  // reads as still "closing" rather than "closed" at the instant it closes.
  const atZero = listPricingWindowAlerts(new Date('2026-09-01T00:00:00.000Z'), WINDOWED_TABLE);
  const sonnetAtZero = atZero.find((a) => a.model === 'claude-sonnet-5');
  assert.ok(sonnetAtZero, 'expected the window to still be named at daysRemaining=0');
  assert.equal(sonnetAtZero.status, 'closing');
  assert.equal(sonnetAtZero.daysRemaining, 0);

  // Exactly PRICING_WINDOW_ALERT_DAYS (30) out is included ("<="), 31 is not.
  const at30 = listPricingWindowAlerts(new Date('2026-08-02T00:00:00.000Z'), WINDOWED_TABLE);
  const sonnetAt30 = at30.find((a) => a.model === 'claude-sonnet-5');
  assert.ok(sonnetAt30, 'expected the window to be named at exactly 30 days out');
  assert.equal(sonnetAt30.daysRemaining, 30);
  assert.equal(sonnetAt30.status, 'closing');

  const at31 = listPricingWindowAlerts(new Date('2026-08-01T00:00:00.000Z'), WINDOWED_TABLE);
  assert.equal(
    at31.some((a) => a.model === 'claude-sonnet-5'),
    false,
    '31 days out must not yet be named'
  );
});

// The sort itself: primary key daysRemaining ascending, secondary key model
// name ascending on a tie. WINDOWED_TABLE's two windowed entries happen to
// share one `until` date, but no prior test ever asserted on ORDER, so a
// broken comparator (or a dropped .sort() call entirely) went unnoticed.
test('the staleness query sorts by daysRemaining ascending, model name breaking ties', () => {
  const rates = { inputPerMTok: 1, outputPerMTok: 1, cacheCreatePerMTok: 1, cacheReadPerMTok: 1 };
  // Deliberately inserted OUT of the expected sorted order (beta, alpha,
  // zeta rather than zeta, alpha, beta) - listPricingWindowAlerts iterates
  // Object.entries(table) in insertion order, so a fixture that happens to
  // already BE sorted would pass even with the .sort() call dropped
  // entirely, proving nothing about whether the sort runs.
  const table = {
    beta: { ...rates, until: '2026-09-10' }, // same boundary as alpha: tie
    zeta: { ...rates, until: '2026-08-20' }, // long closed: daysRemaining -16
    alpha: { ...rates, until: '2026-09-10' }, // closing soon: daysRemaining 5
  };
  const alerts = listPricingWindowAlerts(new Date('2026-09-05T12:00:00.000Z'), table);
  assert.deepEqual(
    alerts.map((a) => a.model),
    ['zeta', 'alpha', 'beta'],
    'zeta (most overdue) first, then the tie broken alphabetically'
  );
  assert.deepEqual(
    alerts.map((a) => a.daysRemaining),
    [-16, 5, 5]
  );
});

test('the live table models the Sonnet 5 introductory window BL-627 left out', () => {
  const sonnet = PRICING_TABLE['claude-sonnet-5'];
  assert.equal(sonnet.until, SONNET_5_INTRO_WINDOW_END);
  assert.equal(sonnet.inputPerMTok, 2, 'the intro rate applies inside the window');
  assert.equal(sonnet.outputPerMTok, 10);
  assert.equal(resolveRatesAt(sonnet, at('2026-09-01')).inputPerMTok, 3, 'list price applies after it');
  assert.equal(resolveRatesAt(sonnet, at('2026-09-01')).outputPerMTok, 15);
});

// The CLI wrapper is thin over runPricingWindows/parsePricingWindowsAt, which
// are driven here in-process with a stubbed argv rather than a subprocess.
const {
  parsePricingWindowsAt,
  runPricingWindows,
  main: pricingWindowsMain,
} = require('../out/tools/pricing-windows');

test('the pricing-windows CLI parses a day, defaults to now, and refuses anything else', () => {
  const now = at('2026-08-22');
  assert.equal(parsePricingWindowsAt([], now), now);
  assert.equal(parsePricingWindowsAt(['2026-09-01'], now).toISOString(), '2026-09-01T00:00:00.000Z');
  for (const bad of ['tomorrow', '2026-9-1', '2026-13-45x', '']) {
    assert.equal(parsePricingWindowsAt([bad], now), null, bad);
  }
});

// A shape-valid but calendar-invalid day (JS's Date constructor rolls these
// over rather than returning Invalid Date) must not silently answer for a
// day the operator never typed.
test('the pricing-windows CLI refuses a shape-valid day that JS Date would silently roll over', () => {
  const now = at('2026-08-22');
  for (const rollsOver of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-15']) {
    assert.equal(parsePricingWindowsAt([rollsOver], now), null, rollsOver);
  }
});

test('the pricing-windows report answers for the instant it was asked about', () => {
  const report = runPricingWindows(at('2026-09-01'));
  assert.equal(report.at, '2026-09-01T12:00:00.000Z');
  const sonnet = report.alerts.find((a) => a.model === 'claude-sonnet-5');
  assert.ok(sonnet, `expected the live Sonnet window to be named: ${JSON.stringify(report.alerts)}`);
  assert.equal(sonnet.until, SONNET_5_INTRO_WINDOW_END);
});

test('the pricing-windows CLI main prints the report and refuses a bad day', () => {
  const argv = process.argv;
  const written = [];
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (line) => {
    written.push(line);
    return true;
  };
  process.stderr.write = (line) => {
    written.push(line);
    return true;
  };
  try {
    process.argv = ['node', 'pricing-windows.js', '2026-09-01'];
    pricingWindowsMain();
    assert.match(written.join(''), /claude-sonnet-5/);

    written.length = 0;
    process.exitCode = 0;
    process.argv = ['node', 'pricing-windows.js', 'whenever'];
    pricingWindowsMain();
    assert.match(written.join(''), /Usage: pricing-windows\.js/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  } finally {
    process.argv = argv;
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
});

// BL-1056: the ledger consumers cost each record at ITS instant, not at now -
// otherwise a window makes historical totals drift as the clock moves.
test("ledger costing uses the record's own instant", () => {
  const { deriveSyntheticCostUsd } = require('../out/metrics/syntheticLlmCost');
  const ledgerRecord = (isoAt) => ({
    type: 'llm_invocation',
    at: isoAt,
    model: 'claude-sonnet-5',
    tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costUsd: null,
    origin: {},
  });
  assert.equal(deriveSyntheticCostUsd(ledgerRecord('2026-08-22T00:00:00.000Z')), 2);
  assert.equal(deriveSyntheticCostUsd(ledgerRecord('2026-09-01T00:00:00.000Z')), 3);
});

test("transcript cost telemetry uses each record's own instant", () => {
  const { computeDailyRoleUsage } = require('../out/metrics/costTelemetry');
  const record = (day) => ({
    messageId: day,
    timestampMs: Date.parse(`${day}T00:00:00.000Z`),
    model: 'claude-sonnet-5',
    usage: { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  });
  const byDay = computeDailyRoleUsage({ coder: [record('2026-08-22'), record('2026-09-01')] });
  const costs = Object.values(byDay.coder).map((entry) => entry.costUsd).sort();
  assert.deepEqual(costs, [2, 3], 'each day is costed at the rate in force that day');
});
