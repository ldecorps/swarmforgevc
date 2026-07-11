const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  BACKLOG_DASHBOARD_SCHEMA_VERSION,
  buildBacklogDashboard,
  computeBacklogDashboard,
  translateBacklogDashboard,
  computeNotDoneCount,
} = require('../out/metrics/backlogDashboard');
const { computeDeliveryMetrics } = require('../out/metrics/deliveryMetrics');
const { createTranslationSession } = require('../out/i18n/translate');
const { emptyTranslationCache } = require('../out/i18n/translationCache');

function item(overrides = {}) {
  return { id: 'BL-100', title: 't', status: 'active', ...overrides };
}

function emptyDeliveryMetrics() {
  return {
    velocity: { weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
    burndown: [],
    cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' } },
    forecasts: { tickets: [], milestones: [], throughputPerDay: 0 },
    suiteDurationTrend: { hasLocalData: false, dailySeries: [], trend: { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' } },
  };
}

// ── buildBacklogDashboard (pure) ─────────────────────────────────────────

test('schema_version is present (dashboard-05)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc123', '2026-07-09T00:00:00Z');
  assert.equal(data.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION);
  assert.equal(typeof data.schemaVersion, 'number');
});

test('carries the generation timestamp and source SHA (dashboard-01)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc123', '2026-07-09T00:00:00Z');
  assert.equal(data.sourceSha, 'abc123');
  assert.equal(data.generatedAtIso, '2026-07-09T00:00:00Z');
});

test('an active ticket appears on the board with its swarm (defaulting to local/primary)', () => {
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active.length, 1);
  assert.equal(data.board.active[0].id, 'BL-100');
  assert.equal(data.board.active[0].swarm, 'primary');
});

test('a ticket with an explicit swarm field keeps that assignment, not the local default', () => {
  const data = buildBacklogDashboard({ active: [item({ swarm: 'secondary-1' })], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].swarm, 'secondary-1');
});

test('a paused ticket appears under board.paused', () => {
  const data = buildBacklogDashboard({ active: [], paused: [item({ id: 'BL-101' })], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.paused.length, 1);
  assert.equal(data.board.paused[0].id, 'BL-101');
});

test('done tickets are grouped by milestone', () => {
  const done = [item({ id: 'BL-101', status: 'done', milestone: 'M1' }), item({ id: 'BL-102', status: 'done', milestone: 'M2' })];
  const data = buildBacklogDashboard({ active: [], paused: [], done }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(data.board.doneByMilestone.M1.map((t) => t.id), ['BL-101']);
  assert.deepEqual(data.board.doneByMilestone.M2.map((t) => t.id), ['BL-102']);
});

test('an active ticket carries its spec date from the lifecycle join', () => {
  const lifecycles = [{ ticketId: 'BL-100', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: null }];
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, lifecycles, emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].specDateIso, '2026-06-01T00:00:00Z');
});

test('a done ticket carries both spec and close dates', () => {
  const lifecycles = [{ ticketId: 'BL-100', specDateIso: '2026-06-01T00:00:00Z', closeDateIso: '2026-06-05T00:00:00Z' }];
  const data = buildBacklogDashboard({ active: [], paused: [], done: [item({ status: 'done' })] }, lifecycles, emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  const ticket = data.board.doneByMilestone.unspecified[0];
  assert.equal(ticket.specDateIso, '2026-06-01T00:00:00Z');
  assert.equal(ticket.closeDateIso, '2026-06-05T00:00:00Z');
});

test('an open ticket carries its p50/p85 forecast from the delivery metrics join', () => {
  const metrics = emptyDeliveryMetrics();
  metrics.forecasts.tickets = [{ ticketId: 'BL-100', p50Iso: '2026-08-01T00:00:00Z', p85Iso: '2026-08-10T00:00:00Z' }];
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], metrics, 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.board.active[0].p50Iso, '2026-08-01T00:00:00Z');
  assert.equal(data.board.active[0].p85Iso, '2026-08-10T00:00:00Z');
});

test('a ticket with no forecast simply omits the p50/p85 fields, not null placeholders', () => {
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data.board.active[0], 'p50Iso'), false);
});

test('velocity, burndown, cycle-time, and forecasts pass through unmodified from delivery metrics (dashboard-02 parity)', () => {
  const metrics = emptyDeliveryMetrics();
  metrics.velocity.rollingWindowCount = 7;
  metrics.cycleTime.medianMs = 12345;
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], metrics, 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.deepEqual(data.metrics.velocity, metrics.velocity);
  assert.deepEqual(data.metrics.burndown, metrics.burndown);
  assert.deepEqual(data.metrics.cycleTime, metrics.cycleTime);
  assert.deepEqual(data.metrics.forecasts, metrics.forecasts);
});

test('suite-duration trend is never included (test-suite duration is gitignored/local-only, excluded per the ticket)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data.metrics, 'suiteDurationTrend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'suiteDurationTrend'), false);
});

test('an empty backlog produces an empty, valid, non-throwing dashboard', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', null, '2026-07-09T00:00:00Z');
  assert.deepEqual(data.board.active, []);
  assert.deepEqual(data.board.paused, []);
  assert.deepEqual(data.board.doneByMilestone, {});
  assert.equal(data.sourceSha, null);
});

// ── BL-251: needsApproval - the single-source pending-approval set ───────
// Derived ONLY from the structured human_approval field (backlogReader.ts),
// never re-parsed from the free-text "# HUMAN APPROVAL:" comment - the PWA
// and the daily briefing both read this same computed field so they can
// never disagree.

test('a live active ticket with human_approval: pending appears in needsApproval with its id and title', () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-100', title: 'Needs a look', humanApproval: 'pending' })], paused: [], done: [] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.deepEqual(data.needsApproval, [{ id: 'BL-100', title: 'Needs a look' }]);
});

test('a live paused ticket with human_approval: pending is included too (both active and paused are "live")', () => {
  const data = buildBacklogDashboard(
    { active: [], paused: [item({ id: 'BL-101', humanApproval: 'pending' })], done: [] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.deepEqual(data.needsApproval.map((t) => t.id), ['BL-101']);
});

test('an approved ticket is never in needsApproval', () => {
  const data = buildBacklogDashboard(
    { active: [item({ humanApproval: 'approved' })], paused: [], done: [] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.deepEqual(data.needsApproval, []);
});

test('a ticket with no human_approval field at all is never in needsApproval', () => {
  const data = buildBacklogDashboard(
    { active: [item()], paused: [], done: [] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.deepEqual(data.needsApproval, []);
});

test('a done ticket with human_approval: pending is excluded - only active/paused are "live"', () => {
  const data = buildBacklogDashboard(
    { active: [], paused: [], done: [item({ status: 'done', humanApproval: 'pending' })] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.deepEqual(data.needsApproval, []);
});

test('needsApproval is always present, even empty - never absent (both surfaces render an explicit no-data state from it)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'needsApproval'), true);
  assert.deepEqual(data.needsApproval, []);
});

// ── BL-263: notDoneCount - the single-source not-done total ─────────────

// BL-263 count-excludes-done-01
test('notDoneCount totals active + paused and excludes done tickets', () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-1' }), item({ id: 'BL-2' })], paused: [item({ id: 'BL-3' })], done: [item({ id: 'BL-4', status: 'done' }), item({ id: 'BL-5', status: 'done' })] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.equal(data.notDoneCount, 3);
});

test('computeNotDoneCount is a pure function of the active/paused arrays alone', () => {
  assert.equal(computeNotDoneCount([item({ id: 'BL-1' }), item({ id: 'BL-2' })], [item({ id: 'BL-3' })]), 3);
  assert.equal(computeNotDoneCount([], []), 0);
});

// BL-263 zero-state-03
test('notDoneCount is zero (not blank, not an error) when every ticket is done', () => {
  const data = buildBacklogDashboard(
    { active: [], paused: [], done: [item({ id: 'BL-1', status: 'done' }), item({ id: 'BL-2', status: 'done' })] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  assert.equal(data.notDoneCount, 0);
  assert.equal(typeof data.notDoneCount, 'number');
});

test('notDoneCount is always present, even at zero - never absent', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'notDoneCount'), true);
  assert.equal(data.notDoneCount, 0);
});

// BL-263 derived-not-stored-04: notDoneCount rides the same schemaVersion,
// no new store - a version bump would signal a new authoritative field
// this ticket must NOT introduce.
test('notDoneCount is additive - schemaVersion is unchanged', () => {
  const data = buildBacklogDashboard({ active: [item()], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(data.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION);
});

// BL-263 surfaces-agree-02: translateBacklogDashboard (the PWA-facing i18n
// pass) must carry notDoneCount through untouched - the briefing composes
// from the SAME buildBacklogDashboard output, so if translation silently
// dropped or altered the field the two surfaces would diverge.
test('translateBacklogDashboard carries notDoneCount through unchanged', async () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-1' })], paused: [item({ id: 'BL-2' })], done: [] },
    [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z'
  );
  const session = createTranslationSession(emptyTranslationCache(), fakeEngine({}));
  const translated = await translateBacklogDashboard(data, session);
  assert.equal(translated.notDoneCount, data.notDoneCount);
  assert.equal(translated.notDoneCount, 2);
});

// ── BL-213 cost-06a/06b: costHealth fold-in ──────────────────────────────

test('costHealth is folded in verbatim when a sidecar is provided (cost-06a)', () => {
  const sidecar = { schemaVersion: 1, dateIso: '2026-07-09', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] };
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z', sidecar);
  assert.deepEqual(data.costHealth, sidecar);
  assert.equal(data.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION, 'schemaVersion is unchanged - costHealth is additive');
});

test('costHealth is omitted entirely (not null) when no sidecar is provided (cost-06b: hidden when absent)', () => {
  const data = buildBacklogDashboard({ active: [], paused: [], done: [] }, [], emptyDeliveryMetrics(), 'primary', 'abc', '2026-07-09T00:00:00Z');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'costHealth'), false);
});

// ── computeBacklogDashboard (impure orchestrator, real git repo) ────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backlog-dashboard-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('computeBacklogDashboard wires git history + current backlog state into one dashboard payload, matching the metrics CLI (dashboard-01/02)', () => {
  const repo = mkTmp();
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-101.yaml'), 'id: BL-101\ntitle: t\nstatus: active\nmilestone: M4\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'spec BL-101'], '2026-06-01T08:00:00');

  mkdirp(path.join(repo, 'backlog', 'done', 'M4'));
  git(repo, ['mv', 'backlog/active/BL-101.yaml', 'backlog/done/M4/BL-101.yaml']);
  git(repo, ['commit', '-q', '-m', 'close BL-101'], '2026-06-05T08:00:00');

  const nowMs = Date.parse('2026-06-10T00:00:00Z');
  const dashboard = computeBacklogDashboard(repo, [], nowMs);
  const cliMetrics = computeDeliveryMetrics(repo, [], nowMs);

  assert.deepEqual(dashboard.metrics.velocity, cliMetrics.velocity);
  assert.deepEqual(dashboard.metrics.cycleTime, cliMetrics.cycleTime);
  assert.equal(dashboard.board.doneByMilestone.M4[0].id, 'BL-101');
  assert.ok(dashboard.sourceSha, 'a real repo must resolve a source SHA');
  assert.equal(dashboard.schemaVersion, BACKLOG_DASHBOARD_SCHEMA_VERSION);
});

test('computeBacklogDashboard folds in the most recently committed sidecar (cost-06a)', () => {
  const repo = mkTmp();
  mkdirp(path.join(repo, 'backlog', 'active'));
  mkdirp(path.join(repo, 'docs', 'briefings'));
  fs.writeFileSync(
    path.join(repo, 'docs', 'briefings', '2026-07-08.json'),
    JSON.stringify({ schemaVersion: 1, dateIso: '2026-07-08', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] })
  );
  fs.writeFileSync(
    path.join(repo, 'docs', 'briefings', '2026-07-09.json'),
    JSON.stringify({ schemaVersion: 1, dateIso: '2026-07-09', agents: [], topExpensiveTickets: [], flowBalance: {}, reliability: {}, resourceAnomalies: [] })
  );

  const dashboard = computeBacklogDashboard(repo, [], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(dashboard.costHealth.dateIso, '2026-07-09', 'the latest sidecar by date must win, not just directory order');
});

test('computeBacklogDashboard omits costHealth when no sidecar has ever been committed (cost-06b)', () => {
  const repo = mkTmp();
  mkdirp(path.join(repo, 'backlog', 'active'));

  const dashboard = computeBacklogDashboard(repo, [], Date.parse('2026-07-09T12:00:00Z'));
  assert.equal(Object.prototype.hasOwnProperty.call(dashboard, 'costHealth'), false);
});

// ── translateBacklogDashboard (BL-118) ───────────────────────────────────

function fakeEngine(translations = {}) {
  return {
    async translate(text) {
      if (text in translations) {
        return { success: true, text: translations[text] };
      }
      return { success: false, error: 'no fake translation' };
    },
  };
}

test('translateBacklogDashboard adds titleTranslations.fr to every active/paused/done ticket, leaving English titles unchanged', async () => {
  const data = buildBacklogDashboard(
    {
      active: [item({ id: 'BL-1', title: 'active ticket' })],
      paused: [item({ id: 'BL-2', title: 'paused ticket' })],
      done: [item({ id: 'BL-3', title: 'done ticket', milestone: 'M1' })],
    },
    [],
    emptyDeliveryMetrics(),
    'primary',
    'abc',
    '2026-07-09T00:00:00Z'
  );
  const engine = fakeEngine({ 'active ticket': 'ticket actif', 'paused ticket': 'ticket en pause', 'done ticket': 'ticket terminé' });
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateBacklogDashboard(data, session);

  assert.equal(translated.board.active[0].title, 'active ticket');
  assert.equal(translated.board.active[0].titleTranslations.fr.title, 'ticket actif');
  assert.equal(translated.board.paused[0].titleTranslations.fr.title, 'ticket en pause');
  assert.equal(translated.board.doneByMilestone.M1[0].titleTranslations.fr.title, 'ticket terminé');
});

test('bilingual-05: an unavailable translation flags titleTranslations.fr.untranslated rather than failing', async () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-1', title: 'no translation' })], paused: [], done: [] },
    [],
    emptyDeliveryMetrics(),
    'primary',
    'abc',
    '2026-07-09T00:00:00Z'
  );
  const session = createTranslationSession(emptyTranslationCache(), fakeEngine({}));

  const translated = await translateBacklogDashboard(data, session);

  assert.equal(translated.board.active[0].titleTranslations.fr.title, 'no translation');
  assert.equal(translated.board.active[0].titleTranslations.fr.untranslated, true);
});

// ── BL-230: N-locale generalization + jargon preservation ────────────────

test('BL-230: translateBacklogDashboard populates every configured target locale, not just fr', async () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-1', title: 'active ticket' })], paused: [], done: [] },
    [],
    emptyDeliveryMetrics(),
    'primary',
    'abc',
    '2026-07-09T00:00:00Z'
  );
  const engine = {
    async translate(text, targetLang) {
      return { success: true, text: `[${targetLang}] ${text}` };
    },
  };
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateBacklogDashboard(data, session);

  // TARGET_LOCALES (targetLocales.ts) is ['fr'] today - this proves the
  // translation is keyed by whatever locales are actually configured,
  // not a hardcoded 'fr' field, so a future added locale needs no code
  // change here (add-language-05).
  const { TARGET_LOCALES } = require('../out/i18n/targetLocales');
  for (const locale of TARGET_LOCALES) {
    assert.equal(translated.board.active[0].titleTranslations[locale].title, `[${locale}] active ticket`);
  }
});

test('BL-230: a jargon token (ticket id) in a title survives translation verbatim', async () => {
  const data = buildBacklogDashboard(
    { active: [item({ id: 'BL-1', title: 'Fix BL-230 before release' })], paused: [], done: [] },
    [],
    emptyDeliveryMetrics(),
    'primary',
    'abc',
    '2026-07-09T00:00:00Z'
  );
  const engine = {
    async translate(text) {
      // A realistic MT response: translates the prose, leaves the
      // <jargon> tag pair and its content untouched (DeepL's own
      // ignore_tags contract - mtEngine.test.js covers the request side).
      return { success: true, text: text.replace('Fix', 'Réparer').replace('before release', 'avant la sortie') };
    },
  };
  const session = createTranslationSession(emptyTranslationCache(), engine);

  const translated = await translateBacklogDashboard(data, session);

  assert.equal(translated.board.active[0].titleTranslations.fr.title, 'Réparer BL-230 avant la sortie');
});
