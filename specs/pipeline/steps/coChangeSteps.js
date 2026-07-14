'use strict';

// BL-255: step handlers for "a co-change coupling tool surfaces logical
// coupling from git history for the architect". Drives the REAL
// computeCoChangeReport (extension/out/quality/coChange.js) over a
// hand-built GitLogEntry[] fixture - the SAME injectable-seam shape
// gitHistoryAdapter.ts's own parseGitLog/runGitLog already established
// (BL-096), per the ticket's own "no real git in unit tests" constraint.
const path = require('node:path');

const { computeCoChangeReport } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'quality', 'coChange'));

function commit(hash, dateIso, paths) {
  return { commit: hash, dateIso, changes: paths.map((p) => ({ status: 'M', path: p })) };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^recorded git history of which files changed together in each commit, fed through an injectable seam$/,
    (ctx) => {
      // A shared, varied fixture every scenario's own Given draws specific
      // pairs from: A co-changes with B often, with C rarely; D/E co-change
      // frequently with no import between them (irrelevant to this
      // history-only tool, which never inspects imports at all).
      ctx.history = [
        commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
        commit('c2', '2026-07-02T00:00:00Z', ['A.ts', 'B.ts']),
        commit('c3', '2026-07-03T00:00:00Z', ['A.ts', 'B.ts']),
        commit('c4', '2026-07-04T00:00:00Z', ['A.ts', 'C.ts']),
        commit('c5', '2026-01-01T00:00:00Z', ['A.ts', 'D.ts']),
        commit('c6', '2026-01-02T00:00:00Z', ['A.ts', 'D.ts']),
        commit('c7', '2026-01-03T00:00:00Z', ['D.ts', 'E.ts']),
        commit('c8', '2026-01-04T00:00:00Z', ['D.ts', 'E.ts']),
        commit('c9', '2026-01-05T00:00:00Z', ['D.ts', 'E.ts']),
      ];
      ctx.options = { minFrequency: 3, minGroupSize: 1 };
    }
  );

  // ── ranks-cochangers-01 ──────────────────────────────────────────────
  registry.define(/^a set of changed files under review$/, (ctx) => {
    ctx.changedFiles = ['A.ts'];
  });

  registry.define(/^the co-change analysis runs$/, (ctx) => {
    ctx.report = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
  });

  registry.define(/^it reports, for those files, the other files ranked by how often they co-changed$/, (ctx) => {
    const coChangers = ctx.report.find((r) => r.file === 'A.ts').coChangers;
    const names = coChangers.map((c) => c.file);
    if (names.indexOf('B.ts') === -1 || names.indexOf('C.ts') === -1) {
      throw new Error(`expected both B.ts and C.ts ranked for A.ts, got: ${JSON.stringify(names)}`);
    }
    if (names.indexOf('B.ts') > names.indexOf('C.ts')) {
      throw new Error(`expected B.ts (more frequent co-changer) ranked above C.ts, got order: ${JSON.stringify(names)}`);
    }
  });

  // ── threshold-flags-coupling-02 ───────────────────────────────────────
  registry.define(/^a minimum co-change frequency threshold$/, (ctx) => {
    ctx.options.minFrequency = 3;
    ctx.changedFiles = ['A.ts'];
  });

  registry.define(/^one file pair co-changes at or above that threshold and another below it$/, (ctx) => {
    // A/B co-change 3 times (>= threshold), A/C co-changes 1 time (< threshold) - already in the shared fixture.
    ctx.report = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
  });

  registry.define(/^the at-or-above pair is flagged as suspected logical coupling$/, (ctx) => {
    const b = ctx.report.find((r) => r.file === 'A.ts').coChangers.find((c) => c.file === 'B.ts');
    if (!b || b.coupled !== true) {
      throw new Error(`expected A.ts/B.ts flagged coupled, got: ${JSON.stringify(b)}`);
    }
  });

  registry.define(/^the below-threshold pair is not flagged$/, (ctx) => {
    const c = ctx.report.find((r) => r.file === 'A.ts').coChangers.find((c) => c.file === 'C.ts');
    if (!c || c.coupled !== false) {
      throw new Error(`expected A.ts/C.ts NOT flagged coupled, got: ${JSON.stringify(c)}`);
    }
  });

  // ── surfaces-import-invisible-coupling-03 ────────────────────────────
  registry.define(/^two files that frequently change together but with no import between them$/, (ctx) => {
    // D.ts/E.ts co-change 3 times in the shared fixture - this tool never
    // reads imports at all, so "no import link" is inherently satisfied by
    // construction, not something to fixture separately.
    ctx.changedFiles = ['D.ts'];
    ctx.options.minFrequency = 3;
  });

  registry.define(/^they are reported as coupled$/, (ctx) => {
    ctx.report = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
    const e = ctx.report.find((r) => r.file === 'D.ts').coChangers.find((c) => c.file === 'E.ts');
    if (!e || e.coupled !== true) {
      throw new Error(`expected D.ts/E.ts reported as coupled, got: ${JSON.stringify(e)}`);
    }
  });

  // ── window-is-tunable-04 ──────────────────────────────────────────────
  registry.define(/^a history window limited to the most recent commits$/, (ctx) => {
    // The shared fixture's 3 most recent commits (c1-c4, dated July) are
    // A/B x3 + A/C x1; the older January commits (c5-c9, A/D + D/E) fall
    // outside a window of 4.
    ctx.changedFiles = ['A.ts'];
    ctx.options = { minFrequency: 1, minGroupSize: 1, windowCommits: 4 };
  });

  registry.define(/^commits outside that window are not counted toward co-change frequency$/, (ctx) => {
    ctx.report = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
    const coChangers = ctx.report.find((r) => r.file === 'A.ts').coChangers;
    if (coChangers.some((c) => c.file === 'D.ts')) {
      throw new Error(`expected the older A.ts/D.ts co-change (outside the window) to be excluded, got: ${JSON.stringify(coChangers)}`);
    }
    if (!coChangers.some((c) => c.file === 'B.ts')) {
      throw new Error('expected the in-window A.ts/B.ts co-change to still be counted');
    }
  });

  // ── deterministic-ordering-05 ─────────────────────────────────────────
  registry.define(/^the same recorded history and the same changed files$/, (ctx) => {
    ctx.changedFiles = ['A.ts'];
  });

  registry.define(/^running it again on the same inputs produces the same ranked report$/, (ctx) => {
    const first = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
    const second = computeCoChangeReport(ctx.changedFiles, ctx.history, ctx.options);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error('expected byte-identical reports across repeated runs on identical inputs');
    }
  });
}

module.exports = { registerSteps };
