'use strict';

// BL-1692: step handlers for "the freshness CLI test waits for the
// front-desk status, not its pid file". Both scenarios are static reads
// of the REAL swarmforge/scripts/test/test_build_freshness_cli.sh source
// - never a reimplementation of the fix, never an actual run of the
// shell file (a launcher-driven real front-desk group does not fit the
// per-mutant ceiling, BL-1541; the green run is QA's own e2e step,
// per this ticket's own required_wiring comment and feature preamble).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkLaunchSitesGated } = require('../../../extension/test/helpers/frontDeskLaunchReadiness');

const TEST_FILE = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'test_build_freshness_cli.sh');

const FEATURE = 'BL-1692 the freshness CLI test waits for the front-desk status, not its pid file';

const LAUNCH_MARKER = 'bash "$LAUNCH_FRONT_DESK"';
const READINESS_MARKER = 'wait_for_front_desk_ready';
// A "report or status read" for scenario 02's own purposes: the freshness
// CLI's own report/sync subcommands, or a direct read of the status/pid
// file's fields - the shapes each of the three launch sites' own first
// read after launching actually takes.
const READ_MARKERS = ['bb "$CLI"', 'front-desk-supervisor.status.json'];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the source of swarmforge\/scripts\/test\/test_build_freshness_cli\.sh is read$/, (ctx) => {
    ctx.source = fs.readFileSync(TEST_FILE, 'utf8');
  });

  scoped(/^the merged-code-reaches-daemons-02\/03 case is located$/, (ctx) => {
    const startAnchor = '# ── merged-code-reaches-daemons-02/03(compiled):';
    const start = ctx.source.indexOf(startAnchor);
    assert.ok(start !== -1, `expected to find the 02/03 case's own section anchor in ${TEST_FILE}`);
    const nextAnchor = ctx.source.indexOf('\n# ── ', start + startAnchor.length);
    assert.ok(nextAnchor !== -1, 'expected a following section anchor to bound the 02/03 case');
    ctx.caseBlock = ctx.source.slice(start, nextAnchor);
  });

  scoped(
    /^between its front-desk launch and its first report read it waits on front-desk-supervisor\.status\.json carrying a build_sha for bridge and for bot$/,
    (ctx) => {
      const block = ctx.caseBlock;
      const launchIdx = block.indexOf(LAUNCH_MARKER);
      assert.ok(launchIdx !== -1, `expected the front-desk launch line in the 02/03 case block`);
      const reportIdx = block.indexOf('REPORT_BEFORE=', launchIdx);
      assert.ok(reportIdx !== -1, `expected the first REPORT_BEFORE read in the 02/03 case block`);
      const between = block.slice(launchIdx, reportIdx);
      assert.ok(
        between.includes(READINESS_MARKER),
        `expected ${READINESS_MARKER} between the front-desk launch and the first report read in the 02/03 case, got: ${between}`
      );
      assert.ok(
        between.includes('build_sha'),
        `expected the readiness wait's own build_sha check present between launch and the first report read, got: ${between}`
      );
    }
  );

  scoped(/^it never reads a report with only the pid-file wait before it$/, (ctx) => {
    const block = ctx.caseBlock;
    const launchIdx = block.indexOf(LAUNCH_MARKER);
    const reportIdx = block.indexOf('REPORT_BEFORE=', launchIdx);
    const pidWaitIdx = block.indexOf('front-desk-supervisor.pid', launchIdx);
    assert.ok(pidWaitIdx !== -1 && pidWaitIdx < reportIdx, 'expected a pid-file wait before the first report read');
    const readinessIdx = block.indexOf(READINESS_MARKER, pidWaitIdx);
    assert.ok(
      readinessIdx !== -1 && readinessIdx < reportIdx,
      `expected the readiness wait to sit between the pid-file wait and the first report read, so the pid-file wait is never the ONLY gate before it`
    );
  });

  scoped(/^the front-desk launch sites in the file are counted$/, (ctx) => {
    ctx.gatedCheck = checkLaunchSitesGated(ctx.source, {
      launchMarker: LAUNCH_MARKER,
      readinessMarker: READINESS_MARKER,
      readMarkers: READ_MARKERS,
    });
  });

  scoped(/^there are exactly 3 of them$/, (ctx) => {
    assert.equal(
      ctx.gatedCheck.launchCount,
      3,
      `expected exactly 3 front-desk launch sites, got ${ctx.gatedCheck.launchCount}`
    );
  });

  scoped(/^each is followed by the status readiness wait before any report or status read$/, (ctx) => {
    assert.deepEqual(
      ctx.gatedCheck.violations,
      [],
      `expected every launch site gated by ${READINESS_MARKER} before its first read, violations: ${JSON.stringify(ctx.gatedCheck.violations)}`
    );
  });
}

module.exports = { registerSteps };
