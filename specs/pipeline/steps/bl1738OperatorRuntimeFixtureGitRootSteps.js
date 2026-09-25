'use strict';

// BL-1738: step handlers for "Every operator-runtime acceptance fixture
// roots itself in a git checkout". Scenario 01 drives the REAL shared
// helper (lib/operatorRuntimeFixtureGitRoot.js) against a REAL fixture root
// and the REAL operator_runtime.bb CLI - the same check-root :repository
// gate BL-1517 wired. Scenario 02 is a STATIC read of each of the fourteen
// handler files named in the ticket's own census
// (backlog/active/BL-1738-...yaml) - running all fourteen features
// themselves is too slow a lane for this one (BL-1541); that is the
// ticket's own qa_e2e_procedure instead.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkFixtureGitRoot } = require('./lib/operatorRuntimeFixtureGitRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = path.join(__dirname);
const OPERATOR_RUNTIME = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

// The literal require text every converted handler carries - a direct,
// robust textual marker (the module has exactly one path in this tree), not
// a name/behavior guess.
const SHARED_HELPER_REQUIRE = "require('./lib/operatorRuntimeFixtureGitRoot')";

// BL-421/engineering.prompt Scenario Outline rule: the <handler> column is
// validated against this explicit set, never a bare passthrough - the same
// fourteen filenames the ticket's own census table names.
const KNOWN_HANDLERS = new Set([
  'operatorLongtermMemorySteps.js',
  'operatorAutoHibernateSteps.js',
  'operatorSeedRaceLaunchGraceSteps.js',
  'operatorSelfGenProvenanceSteps.js',
  'answerPairingAcrossThreadsSteps.js',
  'alwaysOnOperatorPresenceSteps.js',
  'controlLossIsNotAgentDeathSteps.js',
  'noInboundMessageIsEverLostSteps.js',
  'bl413StaleSandboxSweepSteps.js',
  'bl458AcceptanceFixtureProcessLeakSteps.js',
  'bl460TmpSweepsBoundDeletesSteps.js',
  'bl466AgentQuestionsAsTelegramPollsSteps.js',
  'bl877PortableProcessLivenessSteps.js',
  'gh26RoleQuestionUndeliverableClearsMarkerSteps.js',
]);

function knownHandlerPath(name) {
  if (!KNOWN_HANDLERS.has(name)) {
    throw new Error(`BL-1738: unrecognized <handler> example value "${name}"`);
  }
  return path.join(STEPS_DIR, name);
}

function registerSteps(registry) {
  registry.define(/^a step handler asks the shared helper for a fixture project root$/, (ctx) => {
    ctx.root = mkFixtureGitRoot('bl1738-scenario-');
  });

  registry.define(/^the root's git common directory is inside the root itself$/, (ctx) => {
    const commonDir = execFileSync('git', ['-C', ctx.root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    assert.ok(
      path.resolve(ctx.root, commonDir).startsWith(ctx.root),
      `git-common-dir must resolve inside the fixture root, got "${commonDir}"`
    );
  });

  registry.define(/^operator_runtime\.bb accepts the root as a project root$/, (ctx) => {
    // --tick-once with OPERATOR_SKIP_LAUNCH=1 - the same posture every
    // adopting handler already uses: a real subprocess, no real LLM/
    // network/long-running loop. The BL-1517 refusal, if it fired, would
    // exit non-zero with REFUSED project-root ... on stderr; execFileSync
    // throws on a non-zero exit, so a refusal fails this step directly.
    execFileSync('bb', [OPERATOR_RUNTIME, ctx.root, '--tick-once'], {
      encoding: 'utf8',
      env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1', SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '' },
    });
  });

  registry.define(/^the step handler (\S+) is read$/, (ctx, handlerName) => {
    ctx.handlerPath = knownHandlerPath(handlerName);
    ctx.handlerSource = fs.readFileSync(ctx.handlerPath, 'utf8');
  });

  registry.define(/^it builds its fixture project roots through the shared helper$/, (ctx) => {
    assert.ok(
      ctx.handlerSource.includes(SHARED_HELPER_REQUIRE),
      `${ctx.handlerPath} does not require the shared helper (${SHARED_HELPER_REQUIRE}) - still builds a bare mkdtemp root`
    );
  });
}

module.exports = { registerSteps };
