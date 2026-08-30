'use strict';

// BL-604: the morning briefing's trend-analysis section. The builder is pure -
// series in, ranked bullets out - so these drive it directly; the CLI's own
// thin wrapper and the briefing wiring are exercised below and by the
// acceptance.

const assert = require('node:assert/strict');
const {
  analyseSeries,
  buildTrendAnalysis,
  loadTrendAnalysis,
  renderTrendAnalysisSection,
  trendSignificance,
  significanceLine,
  TREND_ANALYSIS_MAX_BULLETS,
  TREND_ANALYSIS_HEADING,
} = require('../out/metrics/trendAnalysis');
const { trendAnalysisSectionText, main } = require('../out/tools/trend-analysis-section');

const points = (...values) => values.map((value, i) => ({ periodStart: `2026-08-0${i + 1}`, value }));

function source(id, loadPoints, label = id) {
  return { id, label, producer: `${id}.ts`, loadPoints };
}

describe('BL-604 one series reads as direction, magnitude and significance', () => {
  for (const [current, prior, direction, delta] of [
    [82, 98, 'down', -16],
    [12, 4, 'up', 8],
    [7, 7, 'flat', 0],
  ]) {
    it(`${prior} → ${current} reads as ${direction} ${delta}`, () => {
      const bullet = analyseSeries('approval-taps', 'Approval taps', points(prior, current));

      assert.equal(bullet.direction, direction);
      assert.equal(bullet.delta, delta);
      assert.equal(bullet.currentValue, current);
      assert.equal(bullet.priorValue, prior);
      assert.ok(bullet.text.includes(direction), bullet.text);
      assert.ok(bullet.text.includes('prior period'), `no line of significance: ${bullet.text}`);
    });
  }

  it('takes its direction and delta from computeTrend, never from a second judgement', () => {
    // Three points: computeTrend compares the LAST TWO, so a bullet that
    // fitted its own slope over all three would disagree here.
    const bullet = analyseSeries('s', 'S', points(1, 100, 90));

    assert.equal(bullet.direction, 'down');
    assert.equal(bullet.delta, -10);
  });
});

describe('BL-604 a series that cannot be trended is omitted', () => {
  for (const [name, series] of [
    ['no points at all', points()],
    ['a single point', points(5)],
  ]) {
    it(`is omitted for ${name}`, () => {
      assert.equal(analyseSeries('s', 'S', series), null);
      assert.deepEqual(buildTrendAnalysis([{ id: 's', label: 'S', points: series }]), []);
    });
  }

  it('renders an empty section rather than a heading with nothing under it', () => {
    assert.equal(renderTrendAnalysisSection([]), '');
  });
});

describe('BL-604 ranking and the bound', () => {
  it('leads with the trend that moved most, relative to where it was', () => {
    const bullets = buildTrendAnalysis([
      { id: 'tokens', label: 'Tokens', points: points(1000, 1100) }, // +10%
      { id: 'taps', label: 'Taps', points: points(98, 82) }, // -16%
      { id: 'respawns', label: 'Respawns', points: points(2, 6) }, // +200%
    ]);

    assert.deepEqual(
      bullets.map((b) => b.seriesId),
      ['respawns', 'taps', 'tokens'],
      'an absolute delta would have put tokens first purely for being measured in bigger units'
    );
  });

  it('breaks ties on series id so identical days render identically', () => {
    const bullets = buildTrendAnalysis([
      { id: 'b', label: 'B', points: points(10, 12) },
      { id: 'a', label: 'A', points: points(10, 12) },
    ]);

    assert.deepEqual(bullets.map((b) => b.seriesId), ['a', 'b']);
  });

  it('stops at the declared maximum', () => {
    const many = Array.from({ length: TREND_ANALYSIS_MAX_BULLETS + 4 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      points: points(10, 10 + i + 1),
    }));

    assert.equal(buildTrendAnalysis(many).length, TREND_ANALYSIS_MAX_BULLETS);
  });

  it('honours a caller-supplied bound', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, points: points(10, 20) }));
    assert.equal(buildTrendAnalysis(many, 2).length, 2);
  });
});

describe('BL-604 significance', () => {
  it('is relative to the prior period', () => {
    assert.equal(trendSignificance(10, 100), 0.1);
    assert.equal(trendSignificance(-10, 100), 0.1);
  });

  it('falls back to the absolute delta when the prior period was zero', () => {
    assert.equal(trendSignificance(7, 0), 7);
  });

  it('says what the shape of the move was, never whether it was good news', () => {
    assert.match(significanceLine('flat', 0), /steady/);
    assert.match(significanceLine('up', 1.5), /more than doubled/);
    assert.match(significanceLine('down', 0.3), /material/);
    assert.match(significanceLine('down', 0.01), /small/);
  });
});

describe('BL-604 the impure edge', () => {
  const context = { targetPath: '/nowhere', nowMs: 0 };

  it('drops a series whose loader throws, and keeps the rest', () => {
    const bullets = loadTrendAnalysis(context, [
      source('boom', () => {
        throw new Error('ledger is malformed');
      }),
      source('fine', () => points(4, 8)),
    ]);

    assert.deepEqual(bullets.map((b) => b.seriesId), ['fine']);
  });

  it('maps over the registry it is given, carrying no per-series list', () => {
    const bullets = loadTrendAnalysis(context, [source('only', () => points(1, 2))]);
    assert.deepEqual(bullets.map((b) => b.seriesId), ['only']);
  });

  it('renders the heading and one line per bullet', () => {
    const text = renderTrendAnalysisSection(loadTrendAnalysis(context, [source('s', () => points(4, 8), 'S')]));

    const lines = text.split('\n');
    assert.equal(lines[0], `${TREND_ANALYSIS_HEADING}:`);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^- S: up \+4/);
  });
});

describe('BL-604 the CLI is a thin wrapper', () => {
  it('prints the section for the root it is handed', () => {
    const written = [];
    const realLog = console.log;
    console.log = (...args) => written.push(args.join(' '));
    try {
      main(['/nowhere'], '/elsewhere');
    } finally {
      console.log = realLog;
    }
    // The real registry over an empty root trends nothing, so nothing prints -
    // which is the contract, not a failure.
    assert.deepEqual(written, []);
  });

  it('composes the same text the builder produces', () => {
    const text = trendAnalysisSectionText('/nowhere', {
      sources: [source('s', () => points(10, 5), 'S')],
      nowMs: 0,
    });
    assert.match(text, /^Trend analysis:\n- S: down -5/);
  });
});
