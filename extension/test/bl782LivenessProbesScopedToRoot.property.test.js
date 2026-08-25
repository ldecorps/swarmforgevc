'use strict';

// BL-782 declared invariant: every liveness probe in expedite_cli.bb's teardown
// path matches only processes belonging to the project root under test.
//
// Exercises the REAL probe (no EXPEDITE_PROBE_FILE) against REAL subprocess
// decoys in the process table — the condition that exposed the defect on a host
// running a live swarm.
//
// Runs ONLY via `npm run test:properties`.
//
// Non-vacuity: reverting probe-liveness to bare needles ("handoffd.bb" without
// the root suffix) makes the alien-decoy draw fail on any host with a live
// handoffd for a different root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');
const RUN_TICKET = 'BL-567';

function buildFixtureRepo() {
  const root = fs.realpathSync(mkTmpDir('bl782-probe-'));
  const made = spawnSync('bash', [FIXTURE, root, '--active', RUN_TICKET], { encoding: 'utf8' });
  assert.equal(made.status, 0, `fixture build failed:\n${made.stderr}`);
  return root;
}

function runExpedite(repo) {
  return spawnSync('bb', [CLI, repo, RUN_TICKET, '--no-restart'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPEDITE_STAGE_RUNNER: path.join(repo, 'stage-runner.sh'),
      EXPEDITE_STOP_CMD: './stop-swarm.sh',
      EXPEDITE_START_CMD: './start-swarm.sh',
    },
  });
}

function startDecoy(argvLabel) {
  const child = spawn('bash', ['-c', `exec -a '${argvLabel.replace(/'/g, "'\\''")}' sleep 600`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

function stopDecoy(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

test('BL-782: alien handoffd for another root does not block expedite', () => {
  const repo = buildFixtureRepo();
  const alienRoot = fs.realpathSync(mkTmpDir('bl782-alien-'));
  const decoy = startDecoy(`bb /x/handoffd.bb ${alienRoot}`);
  try {
    const run = runExpedite(repo);
    assert.equal(run.status, 0, `expected clean traverse:\n${run.stdout}${run.stderr}`);
    const done = fs.readdirSync(path.join(repo, 'backlog', 'done'));
    assert.deepEqual(done, [`${RUN_TICKET}-fixture.yaml`]);
  } finally {
    stopDecoy(decoy);
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(alienRoot, { recursive: true, force: true });
  }
});

test('BL-782: genuine babysitterd survivor for this root still refuses', () => {
  const repo = buildFixtureRepo();
  const decoy = startDecoy(`babysitterd.sh ${repo}`);
  try {
    const run = runExpedite(repo);
    assert.notEqual(run.status, 0, 'expected teardown refusal');
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    assert.match(out, /REFUSE teardown did not reach a clean slate/);
    assert.match(out, /babysitterd/);
    assert.equal(fs.readdirSync(path.join(repo, 'backlog', 'done')).length, 0);
  } finally {
    stopDecoy(decoy);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
