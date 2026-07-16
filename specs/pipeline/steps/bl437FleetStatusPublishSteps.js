'use strict';

// BL-437: step handlers for "Each swarm publishes its own rolled-up status
// and the fleet console merges by enumerating them". Drives the REAL
// compiled emit-fleet-status.js (the exact CLI handoffd.bb shells out to
// each chase-sweep cycle - see swarmforge/scripts/handoffd.bb's own
// fleet-status-sweep!) and fleet-console.js modules in-process, against a
// real target repo fixture and a real (tmp, redirected) rendezvous dir -
// never a literal live Babashka daemon process, the same "drive the exact
// function a real cycle calls" posture theContractIsNegotiatedOverTelegram
// Steps.js already established for BL-381's poll-loop.
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

function publishStatusDoc(rendezvousDir, swarmName, doc) {
  const dir = path.join(rendezvousDir, swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(doc));
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^a swarm named "([^"]+)" whose handoffd is running$/, (ctx, swarmName) => {
    ctx.rendezvousDir = mkTmp('bl437-fleet-rendezvous-');
    ctx.env = { SWARMFORGE_FLEET_DIR: ctx.rendezvousDir };
    ctx.targetRepo = mkTmp('bl437-target-');
    writeRolesTsv(ctx.targetRepo, [
      ['coordinator', 'master', ctx.targetRepo, 'session', 'Coordinator', 'claude'],
      ['coder', 'coder', ctx.targetRepo, 'session', 'Coder', 'claude'],
    ]);
    writeHeartbeat(ctx.targetRepo, 'coordinator', new Date().toISOString());
    writeHeartbeat(ctx.targetRepo, 'coder', new Date().toISOString());
    writeSwarmName(ctx.targetRepo, swarmName);
    ctx.swarmName = swarmName;
  });

  // ── fleet-status-publish-01 ────────────────────────────────────────
  registry.define(/^handoffd completes a cycle$/, (ctx) => {
    // The exact function swarmforge/scripts/handoffd.bb's fleet-status-
    // sweep! shells out to via emit-fleet-status.js each chase-sweep cycle.
    ctx.publishedDoc = emitFleetStatus(ctx.targetRepo, Date.now(), ctx.env);
  });
  registry.define(/^it writes ~\/\.swarmforge\/fleet\/fes\/status\.json$/, (ctx) => {
    // In production this resolves under the real operator host's $HOME
    // (emit-fleet-status.ts's own fleetRendezvousDir); the test redirects
    // via the SAME SWARMFORGE_FLEET_DIR env seam production honors, per
    // the engineering article's "a live shared runtime path must be
    // redirectable" rule - never writing into a real developer's home.
    const written = path.join(ctx.rendezvousDir, ctx.swarmName, 'status.json');
    assert.ok(fs.existsSync(written), `expected a published status.json, got nothing at ${written}`);
  });
  registry.define(/^the doc carries the swarm identity, status, children rollup, and updated_at$/, (ctx) => {
    const doc = JSON.parse(fs.readFileSync(path.join(ctx.rendezvousDir, ctx.swarmName, 'status.json'), 'utf8'));
    assert.equal(doc.identity.name, ctx.swarmName);
    assert.equal(typeof doc.status, 'string');
    assert.ok(Array.isArray(doc.children));
    assert.equal(doc.children.length, 1, 'expected exactly the one non-coordinator role (coder)');
    assert.ok(!Number.isNaN(Date.parse(doc.updated_at)), `expected a parseable updated_at, got: ${doc.updated_at}`);
  });

  // ── fleet-status-publish-02 ────────────────────────────────────────
  registry.define(/^the rendezvous dir contains published status\.json files for two swarms$/, (ctx) => {
    ctx.rendezvousDir = ctx.rendezvousDir || mkTmp('bl437-fleet-rendezvous-');
    ctx.env = { SWARMFORGE_FLEET_DIR: ctx.rendezvousDir };
    const now = new Date().toISOString();
    publishStatusDoc(ctx.rendezvousDir, 'fes', {
      identity: { name: 'fes', project: 'free-email-scanner', kind: 'swarm', coordinatorAddress: 'fes/coordinator' },
      status: 'active',
      health: { expected_panes: 4, live_panes: 4, coordinator_alive: true },
      children: [],
      needs_human: false,
      updated_at: now,
    });
    publishStatusDoc(ctx.rendezvousDir, 'primary', {
      identity: { name: 'primary', project: 'swarmforgevc', kind: 'swarm', coordinatorAddress: 'primary/coordinator' },
      status: 'idle',
      health: { expected_panes: 8, live_panes: 8, coordinator_alive: true },
      children: [],
      needs_human: false,
      updated_at: now,
    });
  });
  registry.define(/^the fleet console reads the fleet$/, (ctx) => {
    ctx.rendered = renderFleet(ctx.rendezvousDir);
  });
  registry.define(/^it renders one swarm per status\.json$/, (ctx) => {
    assert.equal(ctx.rendered.swarms.length, 2, `expected exactly two rendered swarms, got: ${JSON.stringify(ctx.rendered.swarms)}`);
  });
  registry.define(/^it does not require a hand-maintained registration file$/, (ctx) => {
    // Proven structurally: renderFleet(rendezvousDir) takes only a
    // directory path - no registration/config file was ever written or
    // referenced anywhere in this scenario's fixture setup above.
    assert.equal(renderFleet.length <= 2, true, 'expected renderFleet to take only a directory (and optional clock), never a config file');
    assert.equal(ctx.rendered.swarms.length, 2);
  });

  // ── fleet-status-publish-03 ────────────────────────────────────────
  registry.define(/^swarm "fes"'s status\.json updated_at is older than the liveness threshold$/, (ctx) => {
    ctx.rendezvousDir = ctx.rendezvousDir || mkTmp('bl437-fleet-rendezvous-');
    publishStatusDoc(ctx.rendezvousDir, 'fes', {
      identity: { name: 'fes', project: 'free-email-scanner', kind: 'swarm', coordinatorAddress: 'fes/coordinator' },
      status: 'active',
      health: { expected_panes: 4, live_panes: 4, coordinator_alive: true },
      children: [],
      needs_human: false,
      updated_at: new Date(0).toISOString(),
    });
  });
  registry.define(/^swarm "fes" renders as stopped with coordinator lost$/, (ctx) => {
    const fes = ctx.rendered.swarms.find((s) => s.identity.name === 'fes');
    assert.ok(fes, `expected a rendered "fes" swarm, got: ${JSON.stringify(ctx.rendered.swarms)}`);
    assert.equal(fes.status, 'stopped (coordinator lost)');
  });

  // ── fleet-status-publish-04 ────────────────────────────────────────
  // The Background above already wrote a REAL "fes" target repo fixture
  // (roles.tsv: coordinator + coder, both with a FRESH heartbeat - a real
  // reconstruction from those files would compute expected_panes=2,
  // live_panes=2, status 'idle'/'active'). This doc deliberately publishes
  // DIFFERENT values that could never come from that real fixture, so a
  // render that reflects the doc's numbers - not the fixture's - proves
  // the console never read the internal files at all.
  registry.define(/^a published status\.json for swarm "fes"$/, (ctx) => {
    ctx.publishedDocFes = {
      identity: { name: 'fes', project: 'free-email-scanner', kind: 'swarm', coordinatorAddress: 'fes/coordinator' },
      status: 'blocked',
      health: { expected_panes: 99, live_panes: 0, coordinator_alive: false },
      children: [],
      needs_human: false,
      updated_at: new Date().toISOString(),
    };
    publishStatusDoc(ctx.rendezvousDir, 'fes', ctx.publishedDocFes);
  });
  registry.define(/^the fleet console renders swarm "fes"$/, (ctx) => {
    ctx.rendered = renderFleet(ctx.rendezvousDir);
    ctx.fesRendered = ctx.rendered.swarms.find((s) => s.identity.name === 'fes');
  });
  registry.define(/^every rendered value is read from a field of the published doc$/, (ctx) => {
    assert.deepEqual(ctx.fesRendered.identity, ctx.publishedDocFes.identity);
    assert.equal(ctx.fesRendered.status, ctx.publishedDocFes.status);
    assert.deepEqual(ctx.fesRendered.health, ctx.publishedDocFes.health);
  });
  registry.define(/^nothing is reconstructed from the swarm's internal role files$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(ctx.targetRepo, '.swarmforge', 'roles.tsv')), 'sanity: the real fixture roles.tsv genuinely exists');
    assert.equal(
      ctx.fesRendered.health.expected_panes,
      99,
      'expected the fabricated 99/0 from the published doc, never the real fixture\'s 2/2 - proof nothing was reconstructed from roles.tsv/heartbeat'
    );
    assert.equal(ctx.fesRendered.health.live_panes, 0);
  });
}

module.exports = { registerSteps };
