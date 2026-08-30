'use strict';

// BL-604 acceptance: the morning briefing carries a trend ANALYSIS - a
// narrative read of the behaviour-trend series, not a re-plot of the charts.
//
// Scenarios 01-04 drive the REAL builder over constructed series. Scenario 05
// drives the REAL send path - briefing_email_lib.bb's own
// send-unsent-briefings!, the same public function handoffd's sweep calls,
// with send-email! capturing the body - because "the section is built" and
// "the section reaches the email that is sent" are different claims, and only
// the second one is what the human asked for. It also reads the two wiring
// facts from the real files, since a key in the vector with no adapter behind
// it (or the reverse) is a section built and called from nowhere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const {
  buildTrendAnalysis,
  loadTrendAnalysis,
  renderTrendAnalysisSection,
  TREND_ANALYSIS_MAX_BULLETS,
  TREND_ANALYSIS_HEADING,
} = require(path.join(OUT, 'metrics', 'trendAnalysis'));

const FEATURE_NAME = 'The morning briefing carries a trend analysis, not just charts';

// Scenario Outline placeholders, validated rather than passed through.
const KNOWN_DIRECTIONS = new Set(['up', 'down', 'flat']);
const KNOWN_POINT_COUNTS = new Set(['0', '1']);

function pointsFrom(values) {
  return values.map((value, i) => ({ periodStart: `2026-08-${String(i + 1).padStart(2, '0')}`, value }));
}

function bulletFor(ctx, seriesId) {
  return ctx.bl604.bullets.find((b) => b.seriesId === seriesId);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the morning briefing's trend-analysis section built over the registered behaviour-trend series$/, (ctx) => {
    ctx.bl604 = { loaded: [] };
    // The registry IS the enumeration: the builder must carry no per-series
    // list of its own, so the shipped section is whatever the registry holds.
    const { TRENDS_BOARD_SERIES } = require(path.join(OUT, 'metrics', 'trendsBoardRegistry'));
    assert.ok(TRENDS_BOARD_SERIES.length > 0, 'no behaviour-trend series are registered');
    ctx.bl604.registered = TRENDS_BOARD_SERIES;
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^a registered series whose latest period is (\S+) and whose prior period is (\S+)$/, (ctx, current, prior) => {
    ctx.bl604.subject = 'subject';
    ctx.bl604.expected = { current: Number(current), prior: Number(prior) };
    ctx.bl604.loaded = [
      { id: 'subject', label: 'Approval taps', points: pointsFrom([Number(prior), Number(current)]) },
    ];
  });

  scoped(/^the trend analysis is built$/, (ctx) => {
    ctx.bl604.bullets = buildTrendAnalysis(ctx.bl604.loaded, ctx.bl604.maxBullets ?? TREND_ANALYSIS_MAX_BULLETS);
    ctx.bl604.text = renderTrendAnalysisSection(ctx.bl604.bullets);
  });

  scoped(/^its bullet for that series states the direction "(.+)"$/, (ctx, direction) => {
    assert.ok(KNOWN_DIRECTIONS.has(direction), `unknown direction example value "${direction}"`);
    const bullet = bulletFor(ctx, ctx.bl604.subject);
    assert.ok(bullet, 'the series produced no bullet at all');
    assert.equal(bullet.direction, direction);
    // The printed word is what reaches the reader, so it is what is asserted.
    assert.ok(bullet.text.includes(` ${direction} `), `the rendered bullet does not say "${direction}": ${bullet.text}`);
  });

  scoped(/^its bullet states the magnitude (\S+)$/, (ctx, delta) => {
    const bullet = bulletFor(ctx, ctx.bl604.subject);
    assert.equal(bullet.delta, Number(delta));
    const printed = Number(delta) > 0 ? `+${delta}` : String(delta);
    assert.ok(bullet.text.includes(printed), `the rendered bullet does not carry ${printed}: ${bullet.text}`);
  });

  scoped(/^its bullet carries one line of significance$/, (ctx) => {
    const bullet = bulletFor(ctx, ctx.bl604.subject);
    const [, significance] = bullet.text.split(' — ');
    assert.ok(significance && significance.trim().length > 0, `no line of significance: ${bullet.text}`);
    assert.ok(!significance.includes('\n'), 'the significance must be ONE line');
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^registered series whose latest periods moved by different magnitudes$/, (ctx) => {
    // Constructed so an ABSOLUTE ranking and a RELATIVE one disagree: tokens
    // moves furthest in raw units and least in proportion. A scenario whose
    // two candidate orderings agree would pass against either rule.
    ctx.bl604.loaded = [
      { id: 'tokens', label: 'Tokens', points: pointsFrom([1000, 1100]) },
      { id: 'taps', label: 'Approval taps', points: pointsFrom([98, 82]) },
      { id: 'respawns', label: 'Self-heal respawns', points: pointsFrom([2, 6]) },
      ...Array.from({ length: TREND_ANALYSIS_MAX_BULLETS }, (_, i) => ({
        id: `filler${i}`,
        label: `Filler ${i}`,
        points: pointsFrom([100, 101]),
      })),
    ];
  });

  scoped(/^the bullets are ordered by significance, largest first$/, (ctx) => {
    const significances = ctx.bl604.bullets.map((b) => b.significance);
    for (let i = 1; i < significances.length; i += 1) {
      assert.ok(
        significances[i - 1] >= significances[i],
        `bullet ${i} moved more than the one before it: ${JSON.stringify(significances)}`
      );
    }
    assert.equal(ctx.bl604.bullets[0].seriesId, 'respawns', 'the largest mover does not lead');
  });

  scoped(/^the section carries no more bullets than its declared maximum$/, (ctx) => {
    assert.ok(
      ctx.bl604.bullets.length <= TREND_ANALYSIS_MAX_BULLETS,
      `${ctx.bl604.bullets.length} bullets exceeds the declared maximum ${TREND_ANALYSIS_MAX_BULLETS}`
    );
    assert.ok(ctx.bl604.loaded.length > TREND_ANALYSIS_MAX_BULLETS, 'the bound was not actually exercised');
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a registered series with (\d+) recorded periods$/, (ctx, points) => {
    assert.ok(KNOWN_POINT_COUNTS.has(points), `unknown points example value "${points}"`);
    ctx.bl604.subject = 'thin';
    ctx.bl604.loaded = [
      { id: 'thin', label: 'Thin series', points: pointsFrom(Array.from({ length: Number(points) }, (_, i) => i + 1)) },
      { id: 'healthy', label: 'Healthy series', points: pointsFrom([4, 8]) },
    ];
  });

  scoped(/^the section carries no bullet for that series$/, (ctx) => {
    assert.equal(bulletFor(ctx, ctx.bl604.subject), undefined, 'a series that cannot be trended was reported anyway');
    assert.ok(
      !ctx.bl604.text.includes(ctx.bl604.loaded.find((s) => s.id === ctx.bl604.subject).label),
      'the omitted series is still named in the rendered section'
    );
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^a registered series whose loader throws$/, (ctx) => {
    ctx.bl604.subject = 'boom';
    ctx.bl604.sources = [
      {
        id: 'boom',
        label: 'Throwing series',
        producer: 'x.ts',
        loadPoints: () => {
          throw new Error('ledger is malformed');
        },
      },
      { id: 'healthy', label: 'Healthy series', producer: 'y.ts', loadPoints: () => pointsFrom([4, 8]) },
    ];
  });

  scoped(/^the morning briefing is sent$/, (ctx) => {
    // "Sent" here is the section being composed on the send path - a throwing
    // loader must cost its own bullet and nothing else, which is the BL-260
    // degrade-never-crash posture this scenario is about.
    ctx.bl604.bullets = loadTrendAnalysis({ targetPath: '/nowhere', nowMs: 0 }, ctx.bl604.sources);
    ctx.bl604.text = renderTrendAnalysisSection(ctx.bl604.bullets);
    ctx.bl604.loaded = ctx.bl604.sources.map((s) => ({ id: s.id, label: s.label, points: [] }));
  });

  scoped(/^the briefing is sent with its other sections intact$/, (ctx) => {
    assert.deepEqual(ctx.bl604.bullets.map((b) => b.seriesId), ['healthy'], 'the throw cost more than its own bullet');
    assert.ok(ctx.bl604.text.includes('Healthy series'), 'the surviving series lost its bullet too');
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^the morning briefing sweep runs with every wired section adapter$/, (ctx) => {
    // The real seam, read from the real files: the key must be in the ordered
    // vector apply-optional-sections walks, AND handoffd must supply an
    // adapter for it. Either one alone is a section built and called from
    // nowhere - which is what required_wiring is armed against.
    const lib = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_email_lib.bb'), 'utf8');
    const daemon = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb'), 'utf8');
    const keys = /\(def optional-section-adapter-keys\s*\[([\s\S]*?)\]\)/.exec(lib);
    assert.ok(keys, 'the optional-section-adapter-keys vector has moved');
    assert.ok(
      /:trend-analysis-section\b/.test(keys[1]),
      'the section key is not in the vector apply-optional-sections walks'
    );
    assert.match(daemon, /:trend-analysis-section\s+trend-analysis-briefing-section/, 'the sweep supplies no adapter');
    assert.match(daemon, /\(defn trend-analysis-briefing-section \[\]/, 'the adapter fn does not exist');
    ctx.bl604.seam = { keys: keys[1] };
  });

  scoped(/^the briefing email is composed$/, (ctx) => {
    // Through the REAL send path - send-unsent-briefings!, the same public
    // function handoffd's sweep calls - with the trend-analysis adapter
    // returning a known section and send-email! capturing the body. Nothing
    // private is reached into: what this asserts is that the section survives
    // all the way to the text handed to the mailer.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl604-briefing-'));
    ctx.bl604.briefingsDir = dir;
    fs.writeFileSync(path.join(dir, '2026-08-30.md'), '# Morning briefing\n\nBODY\n');
    const script = [
      '(require (quote [cheshire.core :as json]))',
      `(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_email_lib.bb')}")`,
      '(def captured (atom nil))',
      '(briefing-email-lib/send-unsent-briefings!',
      ` "${dir}"`,
      ' {:read-briefing-content (fn [f] (slurp (str (babashka.fs/path "' + dir + '" f))))',
      '  :send-email! (fn [subject text & _] (reset! captured text) {:success true})',
      '  :trend-analysis-section (fn [] "Trend analysis:\\n- Marker: up +1")',
      '  :log! (fn [& _] nil)})',
      '(println (json/generate-string {:text @captured}))',
    ].join('\n');
    const run = spawnSync('bb', ['-e', script], { cwd: REPO_ROOT, encoding: 'utf8' });
    ctx.bl604.composed = { status: run.status, out: `${run.stdout}${run.stderr}` };
  });

  scoped(/^the sent body contains the trend-analysis section$/, (ctx) => {
    const { status, out } = ctx.bl604.composed;
    assert.equal(status, 0, `composing the briefing failed: ${out}`);
    assert.ok(out.includes(TREND_ANALYSIS_HEADING), `the composed body carries no trend-analysis section:\n${out}`);
    assert.ok(out.includes('Marker: up +1'), `the section's own content did not reach the body:\n${out}`);
    assert.ok(out.includes('BODY'), 'the rest of the briefing did not survive composition');
    fs.rmSync(ctx.bl604.briefingsDir, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
