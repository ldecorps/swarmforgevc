const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/fleet-console');

// BL-246: the compiled fleet-console CLI actually runs headless over TWO
// independent projects (alpha, beta - each its own .swarmforge/roles.tsv,
// neither sharing a targetPath with the other) and prints a composite
// fleet view - proving "one console, two swarms" has a runnable command
// today, not just a tested-in-isolation rollup module.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fleet-console-cli-'));
}

function writeRolesTsv(targetPath, rows) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeHeartbeat(targetPath, role, lastBeatIso) {
  const dir = path.join(targetPath, '.swarmforge', 'heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.yaml`),
    `role: ${role}\npid: 1\nlast_beat: "${lastBeatIso}"\nlast_tool: Read\nphase: exit\nin_flight: false\nbeat_count: 1\n`
  );
}

function markBacklogActive(targetPath) {
  const dir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'BL-999-fixture.yaml'), 'id: BL-999\n');
}

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'fleet-console.js');

function runCliSubprocess(configFile) {
  const args = configFile !== undefined ? [CLI_PATH, configFile] : [CLI_PATH];
  const output = execFileSync('node', args, { encoding: 'utf8' });
  return JSON.parse(output);
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the branches a subprocess-only smoke test cannot (mirrors
// notifyDeadLettersCli.test.js's own identical seam). main() (built by
// makeArgsGuardedMain) reads its positional args from process.argv.slice(2)
// internally rather than taking a parameter, so process.argv must be faked
// to the same shape the subprocess would have received and restored after.
// Output goes through printJsonToStdout (process.stdout.write), and a
// missing-arg run never throws - it sets process.exitCode instead - so that
// must be captured/restored too, and translated into a rejection here to
// mirror execFileSync's own "non-zero exit throws" behavior.
async function runCli(configFile) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const errWrites = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    errWrites.push(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    process.argv = configFile !== undefined ? ['node', CLI_PATH, configFile] : ['node', CLI_PATH];
    await main();
    if (process.exitCode) {
      throw new Error(errWrites.join('') || `CLI exited with code ${process.exitCode}`);
    }
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
  return JSON.parse(writes.join(''));
}

test('a single-swarm fleet config runs through the SAME CLI with no special-case output shape', async () => {
  const alphaPath = mkTmp();
  writeRolesTsv(alphaPath, [['coordinator', 'master', alphaPath, 'session', 'Coordinator', 'claude']]);
  writeHeartbeat(alphaPath, 'coordinator', new Date().toISOString());

  const configFile = path.join(mkTmp(), 'fleet.json');
  fs.writeFileSync(configFile, JSON.stringify([{ name: 'alpha', project: 'proj-a', targetPath: alphaPath }]));

  const rendered = await runCli(configFile);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.equal(rendered.swarms.length, 1);
  assert.equal(rendered.swarms[0].identity.name, 'alpha');
});

test('the CLI exits non-zero with a usage message when the config file argument is missing', async () => {
  await assert.rejects(() => runCli());
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and lists two independently-rooted swarms rolled up to a fleet', () => {
  const alphaPath = mkTmp();
  writeRolesTsv(alphaPath, [
    ['coordinator', 'master', alphaPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', alphaPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(alphaPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(alphaPath, 'coder', new Date().toISOString());
  markBacklogActive(alphaPath);

  const betaPath = mkTmp();
  writeRolesTsv(betaPath, [
    ['coordinator', 'master', betaPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', betaPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(betaPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(betaPath, 'coder', new Date().toISOString());
  // beta gets no active backlog item and no queued/in-process handoff - all
  // idle with nothing left rolls up to swarm 'done', distinct from alpha.

  const configFile = path.join(mkTmp(), 'fleet.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify([
      { name: 'alpha', project: 'proj-a', targetPath: alphaPath },
      { name: 'beta', project: 'proj-b', targetPath: betaPath },
    ])
  );

  const rendered = runCliSubprocess(configFile);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.deepEqual(
    rendered.swarms.map((s) => s.identity.name),
    ['alpha', 'beta']
  );
  const alphaSwarm = rendered.swarms.find((s) => s.identity.name === 'alpha');
  const betaSwarm = rendered.swarms.find((s) => s.identity.name === 'beta');
  assert.equal(alphaSwarm.identity.project, 'proj-a');
  assert.equal(alphaSwarm.status, 'idle');
  assert.equal(betaSwarm.status, 'done');
  assert.equal(rendered.health.expected_panes, 4);
  assert.equal(rendered.health.live_panes, 4);
});
