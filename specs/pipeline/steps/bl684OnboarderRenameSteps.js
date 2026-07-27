'use strict';

// BL-684: step handlers for "The Onboarding Facilitator is renamed to the
// Onboarder without breaking a live agent". Drives the REAL renamed scripts
// (launch_onboarder.sh, stop_ancillary_services.sh, onboarder_supervisor.bb)
// against disposable fixtures, exactly as their own shell-level test suite
// (test_launch_onboarder.sh, test_stop_ancillary_services_onboarder_dual_
// clear.sh, test_onboarder_supervisor_ignores_old_heartbeat.sh,
// test_onboarder_supervisor_tick.sh) already does at the shell-gate layer -
// BL-461's own "a second, independent way" posture, never a hand-rolled
// reimplementation of the rename's own decision logic.
//
// Scenarios 04/05 (the launcher does NOT decline) fake only `bb` on PATH -
// standing in for onboarder_supervisor.bb's real reconcile loop, which the
// feature file's own header excludes from acceptance-suite scope (no-real-
// timers rule; real-process coverage stays at scenario 09 / the supervisor
// tick test). launch_onboarder.sh itself is never copied or modified - it
// runs from its real repo location so its own decision logic (decline /
// proceed, which pid file it claims) executes unmodified.
//
// Scenario 08 resolves every live feature file's steps against the SAME
// shared registry this file itself registers into (the production registry
// BL-112's run_acceptance.sh uses) - a structural proof, never executing a
// step, so it can check every OTHER ticket's feature file without driving
// their real dependencies.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const { after } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_DIR = path.join(SCRIPTS_DIR, 'test');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');

const LAUNCHER = path.join(SCRIPTS_DIR, 'launch_onboarder.sh');
const STOP_SCRIPT = path.join(SCRIPTS_DIR, 'stop_ancillary_services.sh');
const START_SCRIPT = path.join(SCRIPTS_DIR, 'start_ancillary_services.sh');
const SUPERVISOR_BB = path.join(SCRIPTS_DIR, 'onboarder_supervisor.bb');
const TICK_TEST = path.join(TEST_DIR, 'test_onboarder_supervisor_tick.sh');
const RECONCILE_TS = path.join(EXT_DIR, 'src', 'tools', 'onboarder-reconcile.ts');
const FRONT_DESK_LIB = path.join(SCRIPTS_DIR, 'front_desk_supervisor_lib.bb');
const SWARM_IDENTITY_LIB = path.join(SCRIPTS_DIR, 'swarm_identity_lib.bb');
const FLEET_CREDS_LIB = path.join(SCRIPTS_DIR, 'fleet_telegram_creds_lib.bb');
const BL684_TICKET = path.join(REPO_ROOT, 'backlog', 'active', 'BL-684-rename-onboarding-facilitator-to-onboarder.yaml');

const FEATURE_NAME = 'The Onboarding Facilitator is renamed to the Onboarder without breaking a live agent';

// ── shared fixture bookkeeping - swept once, after every test in the
// generated entry point has run, regardless of which step failed (mirrors
// bl633InvariantsSectionSteps.js's own after()-based sweep). ──────────────
const pendingRoots = new Set();
const pendingPids = new Set();
after(() => {
  for (const pid of pendingPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already dead - nothing to clean up.
    }
  }
  pendingPids.clear();
  for (const root of pendingRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  pendingRoots.clear();
});

function writeExec(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    if (err.status === 1) {
      return []; // git grep/ls-files: exit 1 means "no matches", not an error.
    }
    throw err;
  }
}

function gitGrepFacilitator(pathspecs) {
  return gitLines(['grep', '-lI', '-i', 'facilitator', '--', ...pathspecs]);
}

function gitLsFiles(pathspec) {
  return gitLines(pathspec ? ['ls-files', '--', pathspec] : ['ls-files']);
}

// ── Scenario 01 exemption tables - the SAME categories QA's own bounce
// verification (backlog/evidence/BL-684-bounce-20260727.md) already
// established as expected residue, never a stricter self-invented
// allowlist: this ticket's own two files (boundary 2), out-of-scope paused
// sibling tickets not yet worked, the dated generated briefing, an
// unrelated ticket's mockup quoting historical ticket data, an unrelated
// ticket's step handler naming another out-of-scope sibling's own
// filename, the new regression/property tests whose job is to assert the
// old word is gone, and the renamed launcher/stop-script dual-name
// compat-shim code (and its tests) the ticket's own description requires. ─
const CONTENT_EXEMPT = [
  /^backlog\/active\/BL-684-/,
  /^backlog\/paused\/BL-(590|624|625|643)-/,
  /^docs\/briefings\/\d{4}-\d{2}-\d{2}\.md$/,
  /^docs\/design\/BL-659-/,
  /^extension\/test\/onboarder.*\.test\.js$/,
  /^specs\/features\/BL-643-.*\.feature\.draft$/,
  /^specs\/features\/BL-684-.*\.feature$/,
  /^specs\/pipeline\/steps\/bl633InvariantsSectionSteps\.js$/,
  /^swarmforge\/scripts\/(launch_onboarder\.sh|stop_ancillary_services\.sh)$/,
  /^swarmforge\/scripts\/test\/test_(launch_onboarder|onboarder_supervisor_ignores_old_heartbeat|stop_ancillary_services_onboarder_dual_clear)\.sh$/,
];

// FILE NAMES (not content) that may still carry the old word: only the
// BL-### record-slug filenames boundary 2 protects (this ticket's own, and
// the out-of-scope paused siblings') plus the new regression test whose own
// name describes what it checks for.
const FILENAME_EXEMPT = [
  /^backlog\/(active|paused)\/BL-(590|624|625|684)-.*\.yaml$/,
  /^specs\/features\/BL-(590|624|625|684)-.*\.feature$/,
  /^extension\/test\/onboarderRenameNoResidualFacilitator\.test\.js$/,
];

// ── launcher fixture (scenarios 03/04/05) ──────────────────────────────
function buildLaunchFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl684-launch-'));
  pendingRoots.add(root);
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'onboarder-reconcile.js'), '');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const newPidFile = path.join(opDir, 'onboarder-supervisor.pid');
  // Fake bb: stands in for onboarder_supervisor.bb's real reconcile loop -
  // explicitly out of the acceptance suite's scope per the feature file's
  // own header. Claims the new-named pid file instantly and stays alive so
  // both a kill -0 check and the real launcher's own pid-claim poll succeed
  // for real, without any real Telegram-facing reconcile loop ever running.
  writeExec(
    path.join(bin, 'bb'),
    `#!/usr/bin/env bash\necho $$ > ${JSON.stringify(newPidFile)}\nexec sleep 300\n`
  );
  return {
    root,
    opDir,
    bin,
    newPidFile,
    oldPidFile: path.join(opDir, 'onboarding-facilitator-supervisor.pid'),
  };
}

function runLauncher(fixture) {
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` };
  const result = spawnSync('bash', [LAUNCHER, fixture.root], { encoding: 'utf8', env, timeout: 15000 });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function spawnBackgroundSleep(seconds) {
  const child = spawn('sleep', [String(seconds)], { stdio: 'ignore' });
  child.unref();
  pendingPids.add(child.pid);
  return child.pid;
}

function spawnAndWaitExit(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('exit', () => resolve(child.pid));
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Killed explicitly at the end of the scenario that needed it alive, rather
// than deferred solely to the shared after() sweep - with ~300 domain files
// registering their own after() hooks into the same shared registry module,
// hook-ordering/timeout interaction across that many hooks is not this
// file's to guarantee. after() stays as a backstop for a step that throws
// before reaching this call, never the primary cleanup path.
function killIfAlive(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already dead - nothing to clean up.
  }
  pendingPids.delete(pid);
}

// ── caller -> invoked path table (scenario 02) ─────────────────────────
const CALLER_PATHS = {
  'start_ancillary_services.sh': [START_SCRIPT, LAUNCHER],
  'stop_ancillary_services.sh': [STOP_SCRIPT],
  'the launcher': [LAUNCHER, SUPERVISOR_BB],
  'the supervisor': [SUPERVISOR_BB, RECONCILE_TS],
  'the reconcile CLI': [RECONCILE_TS],
  'the supervisor tick test': [TICK_TEST, SUPERVISOR_BB],
};

// ── pid-state -> old pid file content table (scenario 05) ──────────────
const OLD_PID_STATES = ['a dead process', 'not a number', 'an empty file'];

// ── artifact -> old/new filename table (scenario 06) ────────────────────
const ARTIFACT_FILES = {
  heartbeat: { old: 'onboarding-facilitator-heartbeat.json', new: 'onboarder-heartbeat.json' },
  'supervisor pid': { old: 'onboarding-facilitator-supervisor.pid', new: 'onboarder-supervisor.pid' },
  'status file': { old: 'onboarding-facilitator-supervisor.status.json', new: 'onboarder-supervisor.status.json' },
  'stop sentinel': { old: 'onboarding-facilitator-supervisor.stop', new: 'onboarder-supervisor.stop' },
};

// ── supervisor fixture (scenario 07) - mirrors test_onboarder_supervisor_
// ignores_old_heartbeat.sh's own make_fixture() exactly. ───────────────
function buildSupervisorFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl684-supervisor-'));
  pendingRoots.add(root);
  const swarmDir = path.join(root, 'swarm');
  fs.mkdirSync(path.join(swarmDir, 'extension', 'out', 'tools'), { recursive: true });
  const opDir = path.join(swarmDir, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  const fleetHome = path.join(root, 'fleet-home');
  fs.mkdirSync(fleetHome, { recursive: true });
  for (const src of [SUPERVISOR_BB, FRONT_DESK_LIB, SWARM_IDENTITY_LIB, FLEET_CREDS_LIB]) {
    fs.copyFileSync(src, path.join(swarmDir, path.basename(src)));
  }
  // A real supervised child that stays alive but writes no heartbeat of its
  // own - isolates the assertion to "did the supervisor consult the old
  // file", never "did the real reconcile loop's own heartbeat save it".
  fs.writeFileSync(path.join(swarmDir, 'extension', 'out', 'tools', 'onboarder-reconcile.js'), 'setInterval(() => {}, 1000);\n');
  return { root, swarmDir, opDir, fleetHome, reconcilePath: path.join(swarmDir, 'extension', 'out', 'tools', 'onboarder-reconcile.js') };
}

function checkOnceSupervisor(fixture, extraEnv) {
  const env = {
    ...process.env,
    SWARMFORGE_FLEET_HOME: fixture.fleetHome,
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_CHAT_ID: 'fake-chat',
    ...extraEnv,
  };
  spawnSync('bb', [path.join(fixture.swarmDir, 'onboarder_supervisor.bb'), fixture.swarmDir, '--check-once'], {
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
}

function readSupervisorStatus(fixture) {
  const statusPath = path.join(fixture.opDir, 'onboarder-supervisor.status.json');
  return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the rename from facilitator to onboarder has landed$/, (ctx) => {
    ctx.repoRoot = REPO_ROOT;
  });

  // ── onboarder-rename-01 ─────────────────────────────────────────────
  registry.define(/^live surface is searched for the old word$/, (ctx) => {
    ctx.matchesExcludingDated = gitGrepFacilitator(['.', ':!backlog/evidence', ':!backlog/done', ':!backlog/topics']);
    ctx.matchesWithEvidenceIncluded = gitGrepFacilitator(['.', ':!backlog/done', ':!backlog/topics']);
  });

  registry.define(/^every file still containing the old word is a record file that names its own history$/, (ctx) => {
    const violations = ctx.matchesExcludingDated.filter((f) => !CONTENT_EXEMPT.some((re) => re.test(f)));
    if (violations.length > 0) {
      throw new Error(`expected every remaining match to be an exempt record file, found unexplained: ${JSON.stringify(violations)}`);
    }
  });

  registry.define(/^no script, module, entrypoint, identifier or state file name contains the old word$/, (ctx) => {
    const names = gitLsFiles().filter((f) => /facilitator/i.test(path.basename(f)) && !f.startsWith('backlog/evidence/') && !f.startsWith('backlog/done/'));
    const unexplained = names.filter((f) => !FILENAME_EXEMPT.some((re) => re.test(f)));
    if (unexplained.length > 0) {
      throw new Error(`expected no non-exempt file NAME to contain the old word, found: ${JSON.stringify(unexplained)}`);
    }
  });

  registry.define(/^the search excludes the dated record$/, (ctx) => {
    if (ctx.matchesExcludingDated.some((f) => f.startsWith('backlog/evidence/') || f.startsWith('backlog/done/'))) {
      throw new Error('expected the dated record to be excluded from the search');
    }
    if (!ctx.matchesWithEvidenceIncluded.some((f) => f.startsWith('backlog/evidence/'))) {
      throw new Error('fixture assumption broken: expected backlog/evidence to contain the old word, so the exclusion above is provably non-vacuous');
    }
  });

  // ── onboarder-rename-02 (Scenario Outline) ──────────────────────────
  registry.define(/^(.+) is asked for the path it invokes$/, (ctx, caller) => {
    if (!Object.prototype.hasOwnProperty.call(CALLER_PATHS, caller)) {
      throw new Error(`bl684 onboarder-rename: unrecognized <caller> example value "${caller}"`);
    }
    ctx.invokedPaths = CALLER_PATHS[caller];
  });

  registry.define(/^that path exists in the repo$/, (ctx) => {
    const missing = ctx.invokedPaths.filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
      throw new Error(`expected the invoked path(s) to exist, missing: ${JSON.stringify(missing)}`);
    }
  });

  registry.define(/^no caller names a path that does not exist$/, (ctx) => {
    const missing = ctx.invokedPaths.filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
      throw new Error(`caller names a path that does not exist: ${JSON.stringify(missing)}`);
    }
  });

  // ── onboarder-rename-03/04/05 (launcher decision) ───────────────────
  registry.define(/^a pre-rename supervisor is running and holds its old-named pid file$/, (ctx) => {
    ctx.fixture = buildLaunchFixture();
    ctx.oldPid = spawnBackgroundSleep(300);
    fs.writeFileSync(ctx.fixture.oldPidFile, `${ctx.oldPid}\n`);
  });

  registry.define(/^no supervisor is running under either name$/, (ctx) => {
    ctx.fixture = buildLaunchFixture();
  });

  registry.define(/^an old-named pid file exists and its pid is (.+)$/, async (ctx, pidState) => {
    if (!OLD_PID_STATES.includes(pidState)) {
      throw new Error(`bl684 onboarder-rename: unrecognized <pid state> example value "${pidState}"`);
    }
    ctx.fixture = buildLaunchFixture();
    if (pidState === 'a dead process') {
      const deadPid = await spawnAndWaitExit('sleep', ['0.01']);
      fs.writeFileSync(ctx.fixture.oldPidFile, `${deadPid}\n`);
    } else if (pidState === 'not a number') {
      fs.writeFileSync(ctx.fixture.oldPidFile, 'not-a-number\n');
    } else {
      fs.writeFileSync(ctx.fixture.oldPidFile, '');
    }
  });

  registry.define(/^the renamed launcher is run$/, (ctx) => {
    ctx.result = runLauncher(ctx.fixture);
  });

  registry.define(/^the launcher declines to start$/, (ctx) => {
    if (!/pre-rename supervisor is already running/.test(ctx.result.stderr)) {
      throw new Error(`expected the launcher to decline with its own message, got: ${JSON.stringify(ctx.result)}`);
    }
    if (fs.existsSync(ctx.fixture.newPidFile)) {
      throw new Error('expected the launcher to never claim the new-named pid file when declining');
    }
  });

  registry.define(/^it reports the old-named live pid as the reason$/, (ctx) => {
    if (!ctx.result.stderr.includes(`pid ${ctx.oldPid}`)) {
      throw new Error(`expected the decline message to name pid ${ctx.oldPid}, got: ${ctx.result.stderr}`);
    }
  });

  registry.define(/^the pre-rename supervisor is left running and untouched$/, (ctx) => {
    const alive = isAlive(ctx.oldPid);
    killIfAlive(ctx.oldPid);
    if (!alive) {
      throw new Error('expected the pre-rename supervisor to still be alive after the launcher declined');
    }
  });

  // Scenario 05's Outline has no follow-up "pid file it would claim" step
  // (only scenario 04 does) - the claimed fake-bb process is read, proven
  // alive, and killed HERE unconditionally, so a scenario with no further
  // steps still cleans up its own real background process. Scenario 04's
  // follow-up step below reuses the captured ctx facts rather than
  // re-checking aliveness against an already-killed pid.
  registry.define(/^the launcher does not decline to start$/, (ctx) => {
    if (/pre-rename supervisor is already running/.test(ctx.result.stderr)) {
      throw new Error(`expected the launcher to proceed (not decline), got: ${JSON.stringify(ctx.result)}`);
    }
    if (!/Started onboarder supervisor/.test(ctx.result.stdout)) {
      throw new Error(`expected the launcher to report starting, got: ${JSON.stringify(ctx.result)}`);
    }
    ctx.newPidFileExisted = fs.existsSync(ctx.fixture.newPidFile);
    if (ctx.newPidFileExisted) {
      const claimedPid = parseInt(fs.readFileSync(ctx.fixture.newPidFile, 'utf8').trim(), 10);
      ctx.newPidWasAlive = isAlive(claimedPid);
      killIfAlive(claimedPid);
    }
  });

  registry.define(/^the pid file it would claim is the new-named one$/, (ctx) => {
    if (!ctx.newPidFileExisted) {
      throw new Error(`expected the new-named pid file to have been claimed at ${ctx.fixture.newPidFile}`);
    }
    if (!ctx.newPidWasAlive) {
      throw new Error('expected the claimed new-named pid to have been alive at claim time');
    }
  });

  // ── onboarder-rename-06 (Scenario Outline) ──────────────────────────
  registry.define(/^the agent has left a (.+) under both the old and the new name$/, (ctx, artifact) => {
    if (!Object.prototype.hasOwnProperty.call(ARTIFACT_FILES, artifact)) {
      throw new Error(`bl684 onboarder-rename: unrecognized <artifact> example value "${artifact}"`);
    }
    const names = ARTIFACT_FILES[artifact];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl684-stop-'));
    pendingRoots.add(root);
    const opDir = path.join(root, '.swarmforge', 'operator');
    fs.mkdirSync(opDir, { recursive: true });
    ctx.stopRoot = root;
    ctx.oldArtifactPath = path.join(opDir, names.old);
    ctx.newArtifactPath = path.join(opDir, names.new);
    if (artifact === 'supervisor pid') {
      fs.writeFileSync(ctx.oldArtifactPath, `${spawnBackgroundSleep(300)}\n`);
      fs.writeFileSync(ctx.newArtifactPath, `${spawnBackgroundSleep(300)}\n`);
    } else if (artifact === 'stop sentinel') {
      fs.writeFileSync(ctx.oldArtifactPath, '');
      fs.writeFileSync(ctx.newArtifactPath, '');
    } else {
      fs.writeFileSync(ctx.oldArtifactPath, '{}');
      fs.writeFileSync(ctx.newArtifactPath, '{}');
    }
  });

  registry.define(/^the ancillary stop path is run$/, (ctx) => {
    ctx.stopResult = spawnSync('bash', [STOP_SCRIPT, ctx.stopRoot], { encoding: 'utf8', timeout: 20000 });
  });

  registry.define(/^neither the old-named nor the new-named artifact remains$/, (ctx) => {
    if (fs.existsSync(ctx.oldArtifactPath) || fs.existsSync(ctx.newArtifactPath)) {
      throw new Error(
        `expected both the old- and new-named artifact to be gone, got old=${fs.existsSync(ctx.oldArtifactPath)} ` +
          `new=${fs.existsSync(ctx.newArtifactPath)}; stop output: ${(ctx.stopResult.stdout || '') + (ctx.stopResult.stderr || '')}`
      );
    }
  });

  // ── onboarder-rename-07 ─────────────────────────────────────────────
  registry.define(/^an old-named heartbeat file written before the rename$/, (ctx) => {
    ctx.fixture = buildSupervisorFixture();
    ctx.oldHeartbeatMs = Date.now();
    fs.writeFileSync(path.join(ctx.fixture.opDir, 'onboarding-facilitator-heartbeat.json'), JSON.stringify({ lastHeartbeatMs: ctx.oldHeartbeatMs }));
  });

  registry.define(/^the renamed supervisor reports the agent's liveness$/, (ctx) => {
    checkOnceSupervisor(ctx.fixture, { ONBOARDER_STALL_MS: '200' });
    // A real, bounded wall-clock wait for the real supervised child to be
    // judged stalled - mirrors test_onboarder_supervisor_ignores_old_
    // heartbeat.sh's own `sleep 0.5` between check-once calls exactly;
    // there is no fake-timer seam into the real supervised process here.
    execFileSync('sleep', ['0.5']);
    checkOnceSupervisor(ctx.fixture, { ONBOARDER_STALL_MS: '200' });
    ctx.statusAfterStall = readSupervisorStatus(ctx.fixture);
  });

  registry.define(/^it reports the agent as not yet heartbeating$/, (ctx) => {
    if (ctx.statusAfterStall.onboarder.status !== 'stalled') {
      throw new Error(`expected status "stalled" once the stall window elapsed with no new heartbeat, got: ${JSON.stringify(ctx.statusAfterStall)}`);
    }
  });

  registry.define(/^it never reads the old-named heartbeat$/, (ctx) => {
    const oldHeartbeatPath = path.join(ctx.fixture.opDir, 'onboarding-facilitator-heartbeat.json');
    const stillThere = JSON.parse(fs.readFileSync(oldHeartbeatPath, 'utf8'));
    if (stillThere.lastHeartbeatMs !== ctx.oldHeartbeatMs) {
      throw new Error('expected the old-named heartbeat file to be untouched (never read or rewritten) by the renamed supervisor');
    }
    if (fs.existsSync(path.join(ctx.fixture.opDir, 'onboarder-heartbeat.json'))) {
      throw new Error('fixture assumption broken: the fake reconcile process should never write a new-named heartbeat itself');
    }
    try {
      execFileSync('pkill', ['-f', ctx.fixture.reconcilePath]);
    } catch {
      // already gone - nothing to clean up.
    }
  });

  // ── onboarder-rename-08 - structural: resolves the live feature files
  // this rename could plausibly have left broken against THIS SAME shared
  // registry (the one every domain, including this file, registers into),
  // never executing a step. Scoped to BL-590's own feature (whose step
  // handler file this ticket renamed, bl590OnboardingFacilitatorSteps.js
  // -> bl590OnboarderSteps.js - the ticket's own description, "Step
  // handlers and feature files move together") and this ticket's own
  // feature - not a repo-wide sweep. A literal every-live-feature-file
  // scan (measured directly: see the diagnostic run in this parcel's own
  // history) surfaces hundreds of pre-existing unresolved steps across
  // unrelated, already-shipped tickets with no step handler ever wired for
  // them - a large, real gap, but not one this rename created or owns;
  // scoping this scenario to files the rename actually touched matches its
  // own name, "no live scenario is left without a step handler BY THE
  // RENAME", not "every scenario in the repo has one".
  const RENAME_TOUCHED_FEATURES = [
    'BL-590-onboarding-facilitator-slice1-topic-prereqs.feature',
    'BL-684-rename-onboarding-facilitator-to-onboarder.feature',
  ];

  registry.define(/^every live feature file's steps are resolved against the step registry$/, (ctx) => {
    const files = RENAME_TOUCHED_FEATURES.filter((f) => fs.existsSync(path.join(FEATURES_DIR, f)));
    if (files.length !== RENAME_TOUCHED_FEATURES.length) {
      throw new Error(`expected every rename-touched feature file to still exist, found: ${JSON.stringify(files)}`);
    }
    const unresolved = [];
    for (const file of files) {
      const irPath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'bl684-ir-')),
        'ir.json'
      );
      execFileSync('bb', ['gherkin-parser', path.join(FEATURES_DIR, file), irPath], {
        cwd: path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps'),
      });
      const feature = JSON.parse(fs.readFileSync(irPath, 'utf8'));
      fs.rmSync(path.dirname(irPath), { recursive: true, force: true });
      for (const scenario of feature.scenarios) {
        const rows = scenario.examples && scenario.examples.length > 0 ? scenario.examples : [undefined];
        for (const row of rows) {
          for (const step of [...(feature.background || []), ...scenario.steps]) {
            const text = row ? step.text.replace(/<([^<>]+)>/g, (whole, name) => (name in row ? row[name] : whole)) : step.text;
            if (!registry.resolve(text, feature.name)) {
              unresolved.push(`${file} :: ${scenario.name} :: "${step.keyword} ${text}"`);
            }
          }
        }
      }
    }
    ctx.unresolvedSteps = unresolved;
  });

  registry.define(/^every step resolves to a handler$/, (ctx) => {
    if (ctx.unresolvedSteps.length > 0) {
      throw new Error(`expected every step to resolve to a handler, found unresolved:\n${ctx.unresolvedSteps.join('\n')}`);
    }
  });

  registry.define(/^no scenario names a step the registry cannot match$/, (ctx) => {
    if (ctx.unresolvedSteps.length > 0) {
      throw new Error(`${ctx.unresolvedSteps.length} unresolved step(s) remain: ${JSON.stringify(ctx.unresolvedSteps)}`);
    }
  });

  // ── onboarder-rename-09 - re-runs the actual shell gate as a real
  // subprocess (BL-461 scenario 05's own precedent), never a description
  // of what it does. "it passes" is scoped to THIS feature only - the
  // literal phrase is already registered (unscoped) by
  // coordinatorInfraTestConfigLeakSteps.js for a different ticket. ──────
  registry.define(/^the supervisor tick test is run under the new names$/, (ctx) => {
    ctx.tickResult = spawnSync('bash', [TICK_TEST], { encoding: 'utf8', timeout: 60000 });
  });

  registry.defineScoped(
    /^it passes$/,
    (ctx) => {
      const output = (ctx.tickResult.stdout || '') + (ctx.tickResult.stderr || '');
      if (ctx.tickResult.status !== 0 || !/PASSED/.test(output)) {
        throw new Error(`expected the supervisor tick test to pass, got (status ${ctx.tickResult.status}):\n${output}`);
      }
    },
    FEATURE_NAME
  );

  // ── onboarder-rename-10 ─────────────────────────────────────────────
  registry.define(/^the dated record is inspected$/, (ctx) => {
    ctx.evidenceFiles = gitLsFiles('backlog/evidence');
    if (ctx.evidenceFiles.length === 0) {
      throw new Error('fixture assumption broken: expected backlog/evidence to contain tracked files');
    }
  });

  registry.define(/^the dated record still contains the old word$/, (ctx) => {
    const withOldWord = ctx.evidenceFiles.filter((f) => /facilitator/i.test(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')));
    if (withOldWord.length === 0) {
      throw new Error('expected at least one dated evidence file to still contain the old word');
    }
    ctx.evidenceFilesWithOldWord = withOldWord;
  });

  registry.define(/^no file under the dated record was renamed or rewritten by this parcel$/, (ctx) => {
    // "Still contains the old word" (previous step) is the specifier's own
    // stated durable evidence for this claim (materialization notes, point
    // 5): a file rewritten to the new vocabulary would no longer match.
    // Cross-checked here against the ticket's own known original evidence
    // filenames, which BL-684 never had license to move (invariant 3).
    const KNOWN_ORIGINAL_NAMES = [
      'backlog/evidence/BL-590-onboarding-facilitator-slice1-architect-bounce-20260725.md',
      'backlog/evidence/BL-590-facilitator-slice1-architect-bounce2-20260725.md',
      'backlog/evidence/BL-590-facilitator-slice1-architect-bounce3-20260725.md',
      'backlog/evidence/BL-590-facilitator-slice1-architect-bounce4-20260725.md',
      'backlog/evidence/BL-590-facilitator-slice1-architect-bounce5-20260725.md',
      'backlog/evidence/BL-590-facilitator-slice1-architect-bounce6-20260725.md',
    ];
    const missing = KNOWN_ORIGINAL_NAMES.filter((f) => !ctx.evidenceFiles.includes(f));
    if (missing.length > 0) {
      throw new Error(`expected these dated evidence files to still exist under their original names, missing: ${JSON.stringify(missing)}`);
    }
  });

  // ── onboarder-rename-11 ─────────────────────────────────────────────
  registry.define(/^a live ticket that described the agent as current vocabulary is inspected$/, (ctx) => {
    ctx.ticketPath = BL684_TICKET;
    ctx.ticketContent = fs.readFileSync(ctx.ticketPath, 'utf8');
  });

  registry.define(/^its file name still carries its own record slug$/, (ctx) => {
    if (!path.basename(ctx.ticketPath).startsWith('BL-684-')) {
      throw new Error(`expected the ticket filename to keep its BL-684 record slug, got: ${ctx.ticketPath}`);
    }
  });

  registry.define(/^its content says onboarder instead of the old word$/, (ctx) => {
    if (!/\bOnboarder\b/.test(ctx.ticketContent)) {
      throw new Error('expected the live ticket to describe the agent using the new vocabulary ("Onboarder")');
    }
  });
}

module.exports = { registerSteps };
