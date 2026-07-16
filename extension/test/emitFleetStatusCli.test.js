const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  fleetRendezvousDir,
  fleetStatusPath,
  heartbeatIsSessionAlive,
  isRoleEscalated,
  needsHumanFromAwaitingAnswer,
  buildFleetStatusDoc,
  emitFleetStatus,
  main,
} = require('../out/tools/emit-fleet-status');

// BL-437: emit-fleet-status.js is the ONE place that reconstructs a swarm's
// status from its own internal roles.tsv/heartbeat files (moved here from
// fleet-console.ts, which is now a dumb merger of published docs) - drives
// the REAL compiled createSwarmNode against a real target repo fixture.

function mkTmp() {
  return mkTmpDir('sfvc-emit-fleet-status-');
}

function writeRolesTsv(targetPath, rows) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeHeartbeat(targetPath, role, lastBeatIso, inFlight = false) {
  const dir = path.join(targetPath, '.swarmforge', 'heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.yaml`),
    `role: ${role}\npid: 1\nlast_beat: "${lastBeatIso}"\nlast_tool: Read\nphase: exit\nin_flight: ${inFlight}\nbeat_count: 1\n`
  );
}

function writeSwarmName(targetPath, name) {
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config swarm_name ${name}\n`);
}

// BL-438: chase_sweep_lib.bb's own durable per-role escalation file
// (`.swarmforge/daemon/chase-escalations.json`) - a role key present with
// value `true` means currently stuck-escalated; the daemon DISSOC's the
// key on recovery (never sets it false), so an absent key/file means
// nobody is escalated.
function writeChaseEscalations(targetPath, escalations) {
  const dir = path.join(targetPath, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chase-escalations.json'), JSON.stringify(escalations));
}

// BL-438 architect bounce: the coordinator's own ask+await state
// (operator_runtime.bb's awaiting-answer-file) - a clarifying question is
// outstanding for as long as this file exists; operator_runtime.bb deletes
// it outright (never writes a false/cleared value) the moment an answer
// pairs with it or the escalate-and-drop timeout fires.
function writeAwaitingAnswer(targetPath, record = { question: 'q', thread_id: 'SUP-1', asked_at_ms: 0 }) {
  const dir = path.join(targetPath, '.swarmforge', 'operator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'awaiting-answer.json'), JSON.stringify(record));
}

function removeAwaitingAnswer(targetPath) {
  fs.rmSync(path.join(targetPath, '.swarmforge', 'operator', 'awaiting-answer.json'), { force: true });
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the target repo path when present', () => {
  assert.deepEqual(parseArgs(['/target']), { targetRepoPath: '/target' });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

// ── fleetRendezvousDir / fleetStatusPath ─────────────────────────────────

test('fleetRendezvousDir honors the SWARMFORGE_FLEET_DIR override, never touching the real home directory in a test', () => {
  assert.equal(fleetRendezvousDir({ SWARMFORGE_FLEET_DIR: '/tmp/fake-fleet-dir' }), '/tmp/fake-fleet-dir');
});

test('fleetStatusPath nests the swarm name under the rendezvous dir', () => {
  assert.equal(fleetStatusPath('fes', { SWARMFORGE_FLEET_DIR: '/tmp/fake-fleet-dir' }), path.join('/tmp/fake-fleet-dir', 'fes', 'status.json'));
});

// ── heartbeatIsSessionAlive (moved here from fleet-console.ts) ───────────

test('heartbeatIsSessionAlive reports alive for a fresh heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), true);
});

test('heartbeatIsSessionAlive reports dead for a role with no heartbeat file at all', () => {
  const targetPath = mkTmp();

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), false);
});

test('heartbeatIsSessionAlive reports dead for a stale (long past dead-timeout) heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), false);
});

// Both 'alive' and 'stuck' count as alive here (a stuck role is still a
// live process, just wedged on a tool call) - without this test, only the
// 'alive' disjunct is ever exercised, so a mutant collapsing `=== 'stuck'`
// away survives undetected.
test('heartbeatIsSessionAlive reports alive for a stuck (in-flight past the in-flight timeout) heartbeat', () => {
  const targetPath = mkTmp();
  writeHeartbeat(targetPath, 'coder', new Date(Date.now() - 90 * 1000).toISOString(), true);

  const isAlive = heartbeatIsSessionAlive(targetPath);

  assert.equal(isAlive({ role: 'coder' }), true);
});

// ── isRoleEscalated (pure, BL-438 - PACK-role stuck-mailbox signal) ──────

test('isRoleEscalated is true only for a role whose value is exactly true', () => {
  const escalations = { coder: true, architect: false };
  assert.equal(isRoleEscalated(escalations, 'coder'), true);
  assert.equal(isRoleEscalated(escalations, 'architect'), false);
});

test('isRoleEscalated is false for a role absent from the record', () => {
  assert.equal(isRoleEscalated({}, 'coder'), false);
});

// ── needsHumanFromAwaitingAnswer (BL-438 architect bounce - the REAL
//    needs_human signal: the coordinator's own BL-306 ask+await state,
//    never chase-escalations.json) ───────────────────────────────────────

test('needsHumanFromAwaitingAnswer is true when awaiting-answer.json exists', () => {
  const targetPath = mkTmp();
  writeAwaitingAnswer(targetPath);
  assert.equal(needsHumanFromAwaitingAnswer(targetPath), true);
});

test('needsHumanFromAwaitingAnswer is false when awaiting-answer.json does not exist (never a crash)', () => {
  assert.equal(needsHumanFromAwaitingAnswer(mkTmp()), false);
});

// ── buildFleetStatusDoc / emitFleetStatus ────────────────────────────────

test('buildFleetStatusDoc carries identity, status, health, children, needs_human, and updated_at', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [
    ['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', targetPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(targetPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());
  writeSwarmName(targetPath, 'fes');

  const doc = buildFleetStatusDoc(targetPath, Date.parse('2026-07-15T20:00:00.000Z'));

  assert.equal(doc.identity.name, 'fes');
  assert.equal(doc.identity.kind, 'swarm');
  assert.equal(doc.identity.coordinatorAddress, 'fes/coordinator');
  assert.ok(doc.status);
  assert.equal(doc.health.expected_panes, 2);
  assert.equal(doc.health.live_panes, 2);
  assert.equal(doc.children.length, 1, 'expected one non-coordinator child (coder)');
  assert.equal(doc.children[0].identity.name, 'coder');
  assert.equal(doc.needs_human, false);
  assert.equal(doc.updated_at, '2026-07-15T20:00:00.000Z');
});

// BL-438: the isBlocked-always-false gap - a role the daemon has marked
// stuck-escalated in chase-escalations.json must roll up to a 'blocked'
// AGENT status. This is the PACK-role signal, deliberately distinct from
// needs_human below (architect bounce 2026-07-16): a role can be
// chase-escalated with no pending human question at all.
test('buildFleetStatusDoc rolls the escalated role up to blocked, but chase-escalations alone never sets needs_human', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [
    ['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', targetPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(targetPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());
  writeChaseEscalations(targetPath, { coder: true });

  const doc = buildFleetStatusDoc(targetPath);

  assert.equal(doc.children[0].identity.name, 'coder');
  assert.equal(doc.children[0].status, 'blocked');
  assert.equal(doc.needs_human, false, 'a stuck mailbox is not a pending human question');
});

// The signal must CLEAR on resolution: chase_sweep_lib.bb dissoc's a
// role's key the moment it recovers, so re-reading after that happens (a
// later emit-fleet-status run, on the daemon's own next chase-sweep tick)
// must stop reporting it blocked - never a stale, permanently-pinned block.
test('buildFleetStatusDoc reflects a recovered role (its key removed from chase-escalations.json) as not blocked', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [
    ['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude'],
    ['coder', 'coder', targetPath, 'session', 'Coder', 'claude'],
  ]);
  writeHeartbeat(targetPath, 'coordinator', new Date().toISOString());
  writeHeartbeat(targetPath, 'coder', new Date().toISOString());
  writeChaseEscalations(targetPath, { coder: true });
  const blockedDoc = buildFleetStatusDoc(targetPath);
  assert.equal(blockedDoc.children[0].status, 'blocked');

  writeChaseEscalations(targetPath, {}); // recovered - daemon dissoc'd the key

  const recoveredDoc = buildFleetStatusDoc(targetPath);
  assert.notEqual(recoveredDoc.children[0].status, 'blocked');
});

// ── buildFleetStatusDoc needs_human (BL-438 architect bounce - the ticket's
//    own named E2E scenario: block the coordinator on a human answer) ────

test('buildFleetStatusDoc reports needs_human true when the coordinator is awaiting a human answer (awaiting-answer.json exists)', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeAwaitingAnswer(targetPath);

  const doc = buildFleetStatusDoc(targetPath);

  assert.equal(doc.needs_human, true);
});

test('buildFleetStatusDoc reports needs_human false when no awaiting-answer.json exists at all (never a crash)', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);

  const doc = buildFleetStatusDoc(targetPath);

  assert.equal(doc.needs_human, false);
});

// The signal must CLEAR on resolution (BL-306's own await-pairing/
// escalate-and-drop, operator_runtime.bb) - break-then-fix on the real
// on-disk input per the engineering article's own wiring-test rule: proves
// the read is load-bearing, not merely that the fixture happens to be
// empty by default.
test('buildFleetStatusDoc reflects the human answering (awaiting-answer.json removed) as needs_human false again', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeAwaitingAnswer(targetPath);
  const blockedDoc = buildFleetStatusDoc(targetPath);
  assert.equal(blockedDoc.needs_human, true);

  removeAwaitingAnswer(targetPath); // answered/paired, or escalate-and-drop fired

  const clearedDoc = buildFleetStatusDoc(targetPath);
  assert.equal(clearedDoc.needs_human, false);
});

test('buildFleetStatusDoc defaults the swarm name to "primary" when no swarm_name is configured', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);

  const doc = buildFleetStatusDoc(targetPath);

  assert.equal(doc.identity.name, 'primary');
});

test('emitFleetStatus writes the doc to <rendezvous-dir>/<swarm-name>/status.json', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeSwarmName(targetPath, 'fes');
  const rendezvousDir = mkTmp();

  const doc = emitFleetStatus(targetPath, Date.now(), { SWARMFORGE_FLEET_DIR: rendezvousDir });

  const written = JSON.parse(fs.readFileSync(path.join(rendezvousDir, 'fes', 'status.json'), 'utf8'));
  assert.deepEqual(written, doc);
});

test('emitFleetStatus overwrites a previously-published doc on the next call (never accumulates)', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  writeSwarmName(targetPath, 'fes');
  const rendezvousDir = mkTmp();

  emitFleetStatus(targetPath, Date.parse('2026-07-15T20:00:00.000Z'), { SWARMFORGE_FLEET_DIR: rendezvousDir });
  emitFleetStatus(targetPath, Date.parse('2026-07-15T20:00:05.000Z'), { SWARMFORGE_FLEET_DIR: rendezvousDir });

  const written = JSON.parse(fs.readFileSync(path.join(rendezvousDir, 'fes', 'status.json'), 'utf8'));
  assert.equal(written.updated_at, '2026-07-15T20:00:05.000Z');
});

// ── main() wiring ──────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'emit-fleet-status.js');

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, output: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when the target repo path is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
});

test('main() emits the status doc and prints it to stdout', async () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  const rendezvousDir = mkTmp();
  const previousEnv = process.env.SWARMFORGE_FLEET_DIR;
  process.env.SWARMFORGE_FLEET_DIR = rendezvousDir;
  try {
    const { exitCode, output } = await runCli([targetPath]);
    assert.equal(exitCode, 0);
    const printed = JSON.parse(output);
    assert.equal(printed.identity.name, 'primary');
    assert.ok(fs.existsSync(path.join(rendezvousDir, 'primary', 'status.json')));
  } finally {
    if (previousEnv === undefined) delete process.env.SWARMFORGE_FLEET_DIR;
    else process.env.SWARMFORGE_FLEET_DIR = previousEnv;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and publishes the status doc', () => {
  const targetPath = mkTmp();
  writeRolesTsv(targetPath, [['coordinator', 'master', targetPath, 'session', 'Coordinator', 'claude']]);
  const rendezvousDir = mkTmp();

  const output = execFileSync('node', [CLI_PATH, targetPath], { encoding: 'utf8', env: { ...process.env, SWARMFORGE_FLEET_DIR: rendezvousDir } });
  const printed = JSON.parse(output);

  assert.equal(printed.identity.name, 'primary');
  assert.ok(fs.existsSync(path.join(rendezvousDir, 'primary', 'status.json')));
});
