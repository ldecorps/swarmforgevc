'use strict';

// BL-896: step handlers for "the briefing's open-ticket chart states what it
// measures and never suppresses a sibling section". Scenarios 01-02 drive
// the compiled notDoneBurndown module directly (pure, no shell-out, no
// email, no live git); scenarios 03-04 drive the real briefing_email_lib.bb
// through briefing_email_harness.bb's diagram-sources-independence mode
// (BL-896's own extension of the existing diagram harness - reused rather
// than standing up a second one, per this ticket's own "How" direction; see
// briefingDiagramCidAttachmentsSteps.js/briefingDiagramRenderWidthSteps.js
// for the sibling harness-driving pattern this follows).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const FILE_NAME = '2026-08-16.md';
const DAY_MS = 24 * 60 * 60 * 1000;

function notDoneBurndownModule() {
  // Requires the COMPILED module (matches briefingDiagramRenderWidthSteps.js's
  // own in-process module-surface pattern) - proves out/ is actually built
  // and wired, not just the .ts source.
  return require(path.join(EXT_DIR, 'out', 'metrics', 'notDoneBurndown'));
}

function notDoneBurndownChartModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'notDoneBurndownChart'));
}

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-briefing-open-chart-'));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), 'Headline: shipped a thing\n\nBody.\n');
}

function runHarness(briefingsDir, mode, ...args) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, mode, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

const SHIPPED_EXPECTATIONS = {
  'the architecture charts only': { arch: true, burn: false },
  'the open-ticket chart only': { arch: false, burn: true },
  'both chart sources': { arch: true, burn: true },
  'no charts and a plain note': { arch: false, burn: false },
};

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(
    /^the morning briefing email composes its inline chart section from the architecture render and the open-ticket render$/,
    () => {
      // Framing only - established by BL-260 (architecture render) and this
      // ticket's own render-briefing-burndown.ts (open-ticket render).
    }
  );

  // ── briefing-open-chart-01 ──────────────────────────────────────────
  registry.define(/^a backlog whose open-ticket count rose over the charted window$/, (ctx) => {
    const { computeNotDoneBurndownSeries } = notDoneBurndownModule();
    const nowMs = Date.parse('2026-08-16T12:00:00Z');
    // 8 tickets specced across the window, only 1 closed - the open count
    // rises over the window (net > 0), the exact shape F1's ban reconciles.
    const lifecycles = [];
    for (let i = 0; i < 8; i++) {
      lifecycles.push({
        ticketId: `BL-${i}`,
        specDateIso: new Date(nowMs - (25 - i * 3) * DAY_MS).toISOString(),
        closeDateIso: i === 0 ? new Date(nowMs - 20 * DAY_MS).toISOString() : null,
      });
    }
    ctx.burndownSeries = computeNotDoneBurndownSeries(lifecycles, nowMs, 30);
    if (!(ctx.burndownSeries.net > 0)) {
      throw new Error(`fixture setup error: expected the open count to rise over the window, got net=${ctx.burndownSeries.net}`);
    }
  });

  registry.define(/^the open-ticket chart is rendered$/, (ctx) => {
    const { buildNotDoneBurndownSvg } = notDoneBurndownChartModule();
    ctx.burndownSvg = buildNotDoneBurndownSvg(ctx.burndownSeries);
  });

  registry.define(/^its heading names the series as remaining open tickets over the window$/, (ctx) => {
    if (!/Open tickets remaining/i.test(ctx.burndownSvg)) {
      throw new Error(`expected the heading to name the series as remaining open tickets; got: ${ctx.burndownSvg}`);
    }
  });

  registry.define(
    /^its summary reports the open count at each end of the window with the filed and closed rates$/,
    (ctx) => {
      const { open0, openN } = ctx.burndownSeries;
      const subtitlePattern = new RegExp(`Open ${open0} .* ${openN}`);
      if (!subtitlePattern.test(ctx.burndownSvg)) {
        throw new Error(`expected the summary to report open${open0} → open${openN}; got: ${ctx.burndownSvg}`);
      }
      if (!/Close [\d.]+\/d/.test(ctx.burndownSvg) || !/Mint [\d.]+\/d/.test(ctx.burndownSvg)) {
        throw new Error(`expected the summary to report the filed and closed rates; got: ${ctx.burndownSvg}`);
      }
    }
  );

  registry.define(/^it makes no claim of progress toward a fixed or committed scope$/, (ctx) => {
    if (/burndown/i.test(ctx.burndownSvg) || /\btarget\b/i.test(ctx.burndownSvg) || /remaining to zero/i.test(ctx.burndownSvg)) {
      throw new Error(`expected no claim of progress toward a fixed/committed scope; got: ${ctx.burndownSvg}`);
    }
  });

  registry.define(/^it projects no completion date$/, (ctx) => {
    if (/complet/i.test(ctx.burndownSvg) || /\bETA\b/i.test(ctx.burndownSvg)) {
      throw new Error(`expected no projected completion date; got: ${ctx.burndownSvg}`);
    }
  });

  // ── briefing-open-chart-02 ──────────────────────────────────────────
  registry.define(/^a ticket that was retired by deleting its file rather than moving it to done$/, (ctx) => {
    const nowMs = Date.parse('2026-08-16T12:00:00Z');
    ctx.nowMsForOpenCount = nowMs;
    // BL-2 is lifecycle-open (never closed per deriveTicketLifecycles - the
    // documented F3 gap: a ticket retired by deleting its YAML never gets a
    // close date) but is NOT among the live open ids: it was retired by
    // deletion, not by moving under backlog/done/.
    ctx.openCountLifecycles = [
      { ticketId: 'BL-1', specDateIso: new Date(nowMs - 10 * DAY_MS).toISOString(), closeDateIso: null },
      { ticketId: 'BL-2', specDateIso: new Date(nowMs - 8 * DAY_MS).toISOString(), closeDateIso: null },
    ];
    // Ground truth: only BL-1 is really still in active/paused/hold today.
    ctx.currentOpenTicketIds = new Set(['BL-1']);
  });

  registry.define(/^the open-ticket series is computed for today$/, (ctx) => {
    const { computeNotDoneBurndownSeries } = notDoneBurndownModule();
    ctx.openCountSeries = computeNotDoneBurndownSeries(ctx.openCountLifecycles, ctx.nowMsForOpenCount, 30, ctx.currentOpenTicketIds);
  });

  registry.define(
    /^today's open count equals the number of tickets currently held in the active, paused and hold lanes$/,
    (ctx) => {
      if (ctx.openCountSeries.openN !== ctx.currentOpenTicketIds.size) {
        throw new Error(
          `expected today's open count (${ctx.openCountSeries.openN}) to equal the live lane count (${ctx.currentOpenTicketIds.size})`
        );
      }
    }
  );

  registry.define(/^the retired ticket is not counted as open$/, (ctx) => {
    if (ctx.currentOpenTicketIds.has('BL-2')) {
      throw new Error('fixture setup error: the retired ticket must be absent from the live open-ticket set');
    }
    if (!ctx.openCountLifecycles.some((l) => l.ticketId === 'BL-2' && l.closeDateIso === null)) {
      throw new Error('fixture setup error: expected the retired ticket to still be lifecycle-open (the F3 gap under test)');
    }
    if (ctx.openCountSeries.openN !== 1) {
      throw new Error(`expected the retired ticket to be excluded from today's count (openN=1); got openN=${ctx.openCountSeries.openN}`);
    }
  });

  // ── briefing-open-chart-03 (Scenario Outline) / briefing-open-chart-04 ──
  registry.define(/^the architecture render (succeeds|fails) this run$/, (ctx, word) => {
    ctx.archOutcome = word;
  });

  registry.define(/^the open-ticket render (succeeds|fails) this run$/, (ctx, word) => {
    ctx.burnOutcome = word;
  });

  registry.define(/^a repository whose backlog history yields no chartable days$/, (ctx) => {
    // Mirrors render-briefing-burndown.ts's own contract: an empty/
    // degenerate series makes the CLI exit non-zero, which handoffd.bb's
    // briefing-burndown-json degrades to nil - the identical "fails"
    // outcome scenario 03 exercises, driven through the same mechanism.
    ctx.archOutcome = 'succeeds';
    ctx.burnOutcome = 'fails';
  });

  registry.define(/^the briefing chart section is assembled$/, (ctx) => {
    const dir = ensureBriefingsDir(ctx);
    writeBriefing(dir);
    ctx.result = runHarness(dir, 'diagram-sources-independence', ctx.archOutcome, ctx.burnOutcome);
  });

  registry.define(
    /^the section carries (the architecture charts only|the open-ticket chart only|both chart sources|no charts and a plain note)$/,
    (ctx, shipped) => {
      const html = ctx.result.lastSentHtml || '';
      const hasArch = /<h3>architecture diagram<\/h3>/.test(html);
      const hasBurn = /<h3>Open tickets remaining<\/h3>/.test(html);
      const expected = SHIPPED_EXPECTATIONS[shipped];
      if (hasArch !== expected.arch || hasBurn !== expected.burn) {
        throw new Error(
          `expected shipped="${shipped}" (arch=${expected.arch}, burn=${expected.burn}); got arch=${hasArch}, burn=${hasBurn}, html: ${html}`
        );
      }
      if (shipped === 'no charts and a plain note' && !ctx.result.lastSentText) {
        throw new Error('expected a plain-text note even with no charts');
      }
    }
  );

  registry.define(/^the briefing is sent$/, (ctx) => {
    if (ctx.result.emailsSent !== 1 || !ctx.result.sent.includes(FILE_NAME)) {
      throw new Error(`expected the briefing to send exactly once; got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the open-ticket chart is omitted$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (/<h3>Open tickets remaining<\/h3>/.test(html)) {
      throw new Error(`expected the open-ticket chart to be omitted; got: ${html}`);
    }
  });
}

module.exports = { registerSteps };
