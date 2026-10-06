'use strict';

// BL-1874 (BL-654: coder owns first authorship of each declared invariant's
// property test): the ticket declares one invariant - "After any run of the
// throttle CLI, the recommendation file on disk was written by that run,
// whether the rework refresh succeeded or failed." Drives the REAL compiled
// CLI as a subprocess (the actual process boundary effective_backlog_depth_
// cli.bb crosses), over randomly drawn combinations of: an earlier run's
// recommendation already on disk or not, its cap, and whether THIS run's
// own telemetry write is made to fail. Runs ONLY via `npm run
// test:properties` (vitest.properties.config.mjs) - excluded from unit/
// coverage/mutation, same convention as every other declared-invariant
// property test in this suite.
//
// Non-vacuous: verified by temporarily reverting emit-throttle-
// recommendation.ts's main() to the pre-BL-1874 shape (a bare
// `refreshReworkSignal(args.targetRepoPath)` call, no try/catch) - this
// property then failed on every draw where the telemetry write was blocked
// (the CLI exited 1 before writing anything, leaving the earlier run's
// timestamp and cap standing on disk). Restored before commit.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { throttleRecommendationPath } = require('../out/tools/emit-throttle-recommendation');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'emit-throttle-recommendation.js');

function mkTmp() {
  return mkTmpDir('sfvc-bl1874-refresh-write-prop-');
}

const EARLIER_UPDATED_AT = '2026-01-01T00:00:00.000Z';

function seedEarlierRecommendation(targetPath, cap) {
  const recPath = throttleRecommendationPath(targetPath);
  fs.mkdirSync(path.dirname(recPath), { recursive: true });
  fs.writeFileSync(
    recPath,
    JSON.stringify({
      recommendedCap: cap,
      severity: cap === 0 ? 'severe' : null,
      reworkRate: cap === 0 ? 1 : null,
      baselineRate: cap === 0 ? 0.1 : null,
      standingRed: null,
      updated_at: EARLIER_UPDATED_AT,
      heldCap: null,
      episode: null,
      refreshFailureReason: null,
    })
  );
}

// A FILE sitting where the telemetry directory must be makes
// persistReworkSignal's own fs.mkdirSync(dirname, {recursive}) throw for
// real (EEXIST/ENOTDIR depending on platform) - never a chmod, per the
// Engineering Rules' failure-simulation ban.
function blockTelemetryWrite(targetPath) {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  fs.writeFileSync(path.join(swarmforgeDir, 'telemetry'), 'blocking\n');
}

const scenarioArb = fc.record({
  hasEarlierRecommendation: fc.boolean(),
  earlierCap: fc.constantFrom(0, 1),
  refreshFails: fc.boolean(),
});

test('property (BL-1874 invariant): the recommendation file on disk after any CLI run was written by that run, whether the refresh succeeded or failed', () => {
  fc.assert(
    fc.property(scenarioArb, ({ hasEarlierRecommendation, earlierCap, refreshFails }) => {
      const targetPath = mkTmp();
      if (hasEarlierRecommendation) {
        seedEarlierRecommendation(targetPath, earlierCap);
      }
      if (refreshFails) {
        blockTelemetryWrite(targetPath);
      }

      const beforeMs = Date.now();
      const output = execFileSync('node', [CLI_PATH, targetPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const printed = JSON.parse(output);

      assert.ok(fs.existsSync(throttleRecommendationPath(targetPath)), 'the CLI must always publish a recommendation, refresh or no refresh');
      const written = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetPath), 'utf8'));
      assert.deepEqual(written, printed, "stdout and the file on disk must agree - both are this run's own output");

      const writtenMs = Date.parse(written.updated_at);
      assert.ok(writtenMs >= beforeMs, `expected the file's updated_at to be from THIS run, got ${written.updated_at}`);
      if (hasEarlierRecommendation) {
        assert.notEqual(written.updated_at, EARLIER_UPDATED_AT, "an older run's timestamp must never survive a new run");
      }
      if (refreshFails) {
        assert.equal(written.recommendedCap, null, "a failed refresh must never publish an older run's rework cap");
        assert.ok(
          typeof written.refreshFailureReason === 'string' && written.refreshFailureReason.length > 0,
          `expected a non-empty refreshFailureReason, got: ${JSON.stringify(written.refreshFailureReason)}`
        );
      } else {
        assert.equal(written.refreshFailureReason, null);
      }
    }),
    { numRuns: 20 }
  );
}, 60000);
