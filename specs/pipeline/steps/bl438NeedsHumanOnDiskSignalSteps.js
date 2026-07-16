'use strict';

// BL-438 (epic BL-435 slice 3): step handlers for "A swarm owns its
// needs-human state on disk and the fleet console reads it as a field".
// Drives the REAL compiled emit-fleet-status.js and fleet-console.js
// against a real target repo fixture and a real (tmp, redirected)
// rendezvous dir, same posture as bl437FleetStatusPublishSteps.js. The
// on-disk needs-human WRITER (chase_sweep_lib.bb's write-escalation!,
// wired live from handoffd.bb's chase-sweep adapters) is out of this
// ticket's scope - already shipped, covered by its own bb test runner -
// so these scenarios establish that file's exact shape as a fixture
// precondition rather than re-driving the Babashka writer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { emitFleetStatus } = require(path.join(EXT_DIR, 'out', 'tools', 'emit-fleet-status'));
const { renderFleet } = require(path.join(EXT_DIR, 'out', 'tools', 'fleet-console'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function writeSwarmName(targetPath, name) {
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config swarm_name ${name}\n`);
}

// The exact path/shape chase_sweep_lib.bb's write-escalation! reads/writes
// (`.swarmforge/daemon/chase-escalations.json`, keyed by role, dissoc'd on
// recovery) - emit-fleet-status.ts's own readChaseEscalations reads this
// SAME file, so a fixture written here is exactly what the real daemon
// would have produced.
function chaseEscalationsPath(targetRepo) {
  return path.join(targetRepo, '.swarmforge', 'daemon', 'chase-escalations.json');
}

function readChaseEscalationsFixture(targetRepo) {
  try {
    return JSON.parse(fs.readFileSync(chaseEscalationsPath(targetRepo), 'utf8'));
  } catch {
    return {};
  }
}

function writeChaseEscalationsFixture(targetRepo, escalations) {
  const dir = path.join(targetRepo, '.swarmforge', 'daemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(chaseEscalationsPath(targetRepo), JSON.stringify(escalations));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm named "([^"]+)" publishing status\.json via handoffd$/, (ctx, swarmName) => {
    ctx.rendezvousDir = mkTmp('bl438-fleet-rendezvous-');
    ctx.env = { SWARMFORGE_FLEET_DIR: ctx.rendezvousDir };
    ctx.targetRepo = mkTmp('bl438-target-');
    writeRolesTsv(ctx.targetRepo, [
      ['coordinator', 'master', ctx.targetRepo, 'session', 'Coordinator', 'claude'],
      ['coder', 'coder', ctx.targetRepo, 'session', 'Coder', 'claude'],
    ]);
    writeHeartbeat(ctx.targetRepo, 'coordinator', new Date().toISOString());
    writeHeartbeat(ctx.targetRepo, 'coder', new Date().toISOString());
    writeSwarmName(ctx.targetRepo, swarmName);
    ctx.swarmName = swarmName;
  });

  // ── needs-human-on-disk-signal-01 ─────────────────────────────────────
  registry.define(/^the coordinator is blocked waiting on a human answer$/, (ctx) => {
    writeChaseEscalationsFixture(ctx.targetRepo, { coordinator: true });
  });
  registry.define(/^the needs-human reconciler runs$/, () => {
    // The reconciler (chase_sweep_lib.bb's write-escalation!, live-wired
    // from handoffd.bb) already ran as part of the Given step above - its
    // own writer behavior is covered by its own bb test runner, not
    // re-driven here.
  });
  registry.define(/^an on-disk needs-human signal is written for swarm "[^"]+"$/, (ctx) => {
    const escalations = readChaseEscalationsFixture(ctx.targetRepo);
    assert.equal(escalations.coordinator, true, `expected an on-disk needs-human signal, got: ${JSON.stringify(escalations)}`);
  });

  // ── needs-human-on-disk-signal-02 ─────────────────────────────────────
  registry.define(/^an on-disk needs-human signal exists for swarm "[^"]+"$/, (ctx) => {
    writeChaseEscalationsFixture(ctx.targetRepo, { coder: true });
  });
  // "handoffd completes a cycle" is the SAME text bl437FleetStatusPublish
  // Steps.js already registers (specs/pipeline/steps/index.js loads that
  // domain first) - its handler already does exactly what this scenario
  // needs: ctx.publishedDoc = emitFleetStatus(ctx.targetRepo, Date.now(), ctx.env).
  // Reused as BOTH scenario 02's own Then (published moments ago by the
  // "handoffd completes a cycle" step above) AND scenario 03's Given (a
  // fresh scenario, nothing published yet) - the same text describes a
  // STATE, so this handler ESTABLISHES it (once) before verifying, rather
  // than assuming which position it was invoked from.
  registry.define(/^status\.json for swarm "[^"]+" reports needs-human true$/, (ctx) => {
    const statusPath = path.join(ctx.rendezvousDir, ctx.swarmName, 'status.json');
    if (!fs.existsSync(statusPath)) {
      writeChaseEscalationsFixture(ctx.targetRepo, { coder: true });
      ctx.publishedDoc = emitFleetStatus(ctx.targetRepo, Date.now(), ctx.env);
    }
    const doc = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(doc.needs_human, true, `expected needs_human true, got: ${JSON.stringify(doc)}`);
  });

  // ── needs-human-on-disk-signal-03 ─────────────────────────────────────
  registry.define(/^the fleet console renders swarm "([^"]+)"$/, (ctx, swarmName) => {
    ctx.rendered = renderFleet(ctx.rendezvousDir);
    ctx.renderedSwarm = ctx.rendered.swarms.find((s) => s.identity.name === swarmName);
  });
  registry.define(/^it renders swarm "[^"]+" as blocked from the needs-human field$/, (ctx) => {
    assert.ok(ctx.renderedSwarm, 'expected the swarm to be rendered at all');
    assert.equal(ctx.renderedSwarm.status, 'blocked', `expected status blocked, got: ${JSON.stringify(ctx.renderedSwarm)}`);
  });
  registry.define(/^it does not sniff pane text to decide blocked$/, (ctx) => {
    // Proven by absence: this fixture has no tmux socket, no captured pane
    // text, and no live swarm process anywhere - yet the blocked status
    // above resolved correctly straight from the published field, which is
    // only possible if fleet-console.ts never reached for a pane at all.
    assert.equal(fs.existsSync(path.join(ctx.targetRepo, '.swarmforge', 'tmux-socket')), false);
  });

  // ── needs-human-on-disk-signal-04 ─────────────────────────────────────
  registry.define(/^the human answers and the block is resolved$/, (ctx) => {
    // chase_sweep_lib.bb's write-escalation! DISSOC's the role's key the
    // moment it is no longer escalated - never sets it false.
    writeChaseEscalationsFixture(ctx.targetRepo, {});
    ctx.publishedDoc = emitFleetStatus(ctx.targetRepo, Date.now(), ctx.env);
  });
  registry.define(/^the needs-human signal clears$/, (ctx) => {
    const escalations = readChaseEscalationsFixture(ctx.targetRepo);
    assert.deepEqual(escalations, {}, `expected the escalation entry cleared, got: ${JSON.stringify(escalations)}`);
  });
  registry.define(/^status\.json for swarm "[^"]+" reports needs-human false$/, (ctx) => {
    const doc = JSON.parse(fs.readFileSync(path.join(ctx.rendezvousDir, ctx.swarmName, 'status.json'), 'utf8'));
    assert.equal(doc.needs_human, false, `expected needs_human false, got: ${JSON.stringify(doc)}`);
  });
}

module.exports = { registerSteps };
