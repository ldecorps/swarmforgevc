'use strict';

// BL-252: step handlers for "the holistic UI and daily briefing surface the
// unit-test suite-duration trend and flag regressions". Drives the REAL
// computeSuiteDurationTrend (extension/out/metrics/deliveryMetrics.js,
// already wired to the bridge's /metrics route) for the "holistic UI"
// surface, and the REAL compiled suite-duration-line.js CLI (via execFileSync
// - the same subprocess briefing_email_lib.bb/handoffd.bb shell out to) for
// the "daily briefing" surface. Per the ticket's own TESTABLE-boundary
// note, this asserts on the derived STATE (the warn flag/trend reaching
// each surface) and the assembled briefing line, never rendered HTML or a
// real email send.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { computeSuiteDurationTrend } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'deliveryMetrics')
);

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'suite-duration-line.js');
const BACKLOG_DASHBOARD_SRC = path.join(__dirname, '..', '..', '..', 'extension', 'src', 'metrics', 'backlogDashboard.ts');

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// suite-duration-line.js resolves its project root via `git rev-parse
// --show-toplevel` (same as swarm-metrics.ts/queue-status.ts), so the
// fixture must be a real git repo, not just a directory with roles.tsv.
function mkTarget() {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-suite-duration-'));
  git(targetPath, ['init', '-q']);
  git(targetPath, ['config', 'user.email', 't@t']);
  git(targetPath, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${targetPath}\tsession\tSpecifier\tclaude\ttask\n`
  );
  git(targetPath, ['add', '-A']);
  git(targetPath, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return targetPath;
}

function writeDurationRecords(targetPath, lines) {
  fs.mkdirSync(path.join(targetPath, 'extension'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, 'extension', '.test-durations.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  );
}

// "over the bound": latest run well over 2x the baseline mean, tripping
// the SAME BL-078 relative-creep check computeSuiteDuration already owns.
function overBoundRecords() {
  return [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 5000 },
  ];
}

function withinBoundRecords() {
  return [
    { finished_at: '2026-07-08T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1000 },
    { finished_at: '2026-07-09T00:00:00Z', test_count: 10, result: 'pass', duration_ms: 1100 },
  ];
}

function runBriefingLineCli(targetPath) {
  return execFileSync('node', [CLI_PATH], { cwd: targetPath, encoding: 'utf8' }).trim();
}

// Hardener fix (BL-113 Gherkin mutation): validate the "<state>"/"<flag>"
// example values against the exact known set rather than a binary
// `=== oneLiteral` ternary, which collapses BOTH the real other value AND
// any mutation of it into the same else-branch - a mutated "within The
// bound" or "omitS" is indistinguishable from the real value under that
// shape, so the assertion downstream (itself independently derived from
// the SAME collapsing pattern) trivially agrees with it either way. Same
// lookup-and-reject-unknown pattern as recruiterAcquireSteps.js's
// WALL_TEXT_TO_AUTOMATION (BL-233), bakeoffRosterSteps.js's
// KNOWN_COST_TIERS (BL-250), and docsImplementedStatusSteps.js's
// IMPLEMENTED_BY_TREATMENT (BL-253).
const RECORDS_BY_STATE = {
  'over the bound': overBoundRecords,
  'within the bound': withinBoundRecords,
};

const WARN_BY_FLAG_VERB = {
  shows: true,
  omits: false,
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^machine-local unit-test suite-duration records that feed the suite-duration trend and the BL-078 creep-warning signal$/,
    (ctx) => {
      ctx.targetPath = mkTarget();
    }
  );

  // ── surface-readout-01 ───────────────────────────────────────────────
  registry.define(/^the latest unit-suite duration is "([^"]+)" by the creep-warning criterion$/, (ctx, state) => {
    const recordsFn = RECORDS_BY_STATE[state];
    if (!recordsFn) {
      throw new Error(`unrecognized state "${state}" - expected one of: ${Object.keys(RECORDS_BY_STATE).join(', ')}`);
    }
    writeDurationRecords(ctx.targetPath, recordsFn());
  });

  registry.define(/^the "([^"]+)" renders its suite-duration readout$/, (ctx, surface) => {
    ctx.surface = surface;
    if (surface === 'holistic UI') {
      ctx.holisticState = computeSuiteDurationTrend(ctx.targetPath, [], Date.now());
    } else if (surface === 'daily briefing') {
      ctx.briefingLine = runBriefingLineCli(ctx.targetPath);
    } else {
      throw new Error(`unrecognized surface: "${surface}"`);
    }
  });

  registry.define(/^it shows the latest duration and the trend direction$/, (ctx) => {
    if (ctx.surface === 'holistic UI') {
      if (!ctx.holisticState.hasLocalData || ctx.holisticState.dailySeries.length === 0) {
        throw new Error(`expected the holistic state to carry local data, got: ${JSON.stringify(ctx.holisticState)}`);
      }
    } else {
      if (!/Suite duration trend: \d+s latest/.test(ctx.briefingLine)) {
        throw new Error(`expected the briefing line to show the latest duration, got: "${ctx.briefingLine}"`);
      }
    }
  });

  registry.define(/^it "([^"]+)" a regression flag$/, (ctx, flagVerb) => {
    if (!Object.prototype.hasOwnProperty.call(WARN_BY_FLAG_VERB, flagVerb)) {
      throw new Error(`unrecognized flag verb "${flagVerb}" - expected one of: ${Object.keys(WARN_BY_FLAG_VERB).join(', ')}`);
    }
    const expectWarn = WARN_BY_FLAG_VERB[flagVerb];
    if (ctx.surface === 'holistic UI') {
      if (ctx.holisticState.warn !== expectWarn) {
        throw new Error(`expected holistic warn=${expectWarn}, got ${ctx.holisticState.warn}`);
      }
    } else {
      const hasWarn = /^WARN /.test(ctx.briefingLine);
      if (hasWarn !== expectWarn) {
        throw new Error(`expected briefing WARN prefix=${expectWarn}, got line: "${ctx.briefingLine}"`);
      }
    }
  });

  // ── single-warn-source-02 ────────────────────────────────────────────
  registry.define(/^the BL-078 creep-warning signal marks the unit suite as warning$/, (ctx) => {
    writeDurationRecords(ctx.targetPath, overBoundRecords());
  });

  registry.define(/^the holistic UI and the daily briefing render their suite-duration readouts$/, (ctx) => {
    ctx.holisticState = computeSuiteDurationTrend(ctx.targetPath, [], Date.now());
    ctx.briefingLine = runBriefingLineCli(ctx.targetPath);
  });

  registry.define(/^both flag it as regressing from that same signal rather than a re-derived threshold$/, (ctx) => {
    if (ctx.holisticState.warn !== true) {
      throw new Error(`expected the holistic state to flag regressing, got warn=${ctx.holisticState.warn}`);
    }
    if (!/^WARN /.test(ctx.briefingLine)) {
      throw new Error(`expected the briefing line to flag regressing, got: "${ctx.briefingLine}"`);
    }
    // Structural guard: computeSuiteDurationTrend must derive warn by
    // REUSING computeSuiteDuration, not a second inline threshold - a
    // second `> 2 *` or a second `warnThresholdMs` constant anywhere in
    // this file would be exactly the "re-derived threshold" the ticket
    // forbids.
    const deliveryMetricsSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'extension', 'src', 'metrics', 'deliveryMetrics.ts'),
      'utf8'
    );
    if (!/computeSuiteDuration\(targetPath, roles\)/.test(deliveryMetricsSrc)) {
      throw new Error('expected computeSuiteDurationTrend to reuse computeSuiteDuration directly for its warn flag');
    }
    if (/warnThresholdMs\s*=/.test(deliveryMetricsSrc)) {
      throw new Error('expected no second warn-threshold constant in deliveryMetrics.ts - reuse computeSuiteDuration\'s own');
    }
  });

  // ── no-data-degrades-03 ──────────────────────────────────────────────
  registry.define(/^no machine-local unit-suite duration records exist$/, (ctx) => {
    ctx.targetPath = mkTarget();
    // No .test-durations.jsonl written at all - matches a fresh machine.
  });

  registry.define(/^each shows a no-data state rather than an error or a fabricated value$/, (ctx) => {
    if (ctx.holisticState.hasLocalData !== false || ctx.holisticState.warn !== false) {
      throw new Error(`expected a graceful no-data holistic state, got: ${JSON.stringify(ctx.holisticState)}`);
    }
    if (ctx.briefingLine !== 'Suite duration trend: no local data') {
      throw new Error(`expected the briefing no-data line, got: "${ctx.briefingLine}"`);
    }
  });

  // ── backlog-json-untouched-04 ────────────────────────────────────────
  registry.define(/^the backlog dashboard projection backlog\.json is generated$/, (ctx) => {
    ctx.backlogDashboardSrc = fs.readFileSync(BACKLOG_DASHBOARD_SRC, 'utf8');
  });

  // BL-290 superseded this scenario's original contract ("backlog.json
  // stays free of machine-local data" - now backlog.json/the PWA DO carry
  // suite-duration data, via BL-290's committed sidecar). What still must
  // hold, and is worth guarding here: backlogDashboard.ts itself must
  // NEVER call computeSuiteDurationTrend directly - that would be a live,
  // machine-local read reaching a git-derived projection, breaking
  // reproducibility. It may only fold in whatever value the already-read,
  // COMMITTED costHealth sidecar itself carries (BL-290's own feature file
  // covers the PWA-rendering behavior this now enables).
  registry.define(/^backlog\.json carries the suite-duration trend only through the committed sidecar, never a live machine-local read$/, (ctx) => {
    if (/computeSuiteDurationTrend/.test(ctx.backlogDashboardSrc)) {
      throw new Error(
        'expected backlogDashboard.ts to never call computeSuiteDurationTrend directly - that is a live read and would break git-reproducibility; it must only fold in the value the committed costHealth sidecar already carries'
      );
    }
    if (!/suiteDurationTrend/.test(ctx.backlogDashboardSrc)) {
      throw new Error('expected backlogDashboard.ts to fold suiteDurationTrend in from the committed sidecar (BL-290)');
    }
  });
}

module.exports = { registerSteps };
