const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  isStaleUpdatedAt,
  enumeratePublishedSwarms,
  publishedSwarmToNode,
  renderFleet,
  STALE_AFTER_MS,
} = require('../out/tools/fleet-console');

// BL-437: the fleet console is now a dumb merger - parseArgs/
// enumeratePublishedSwarms/publishedSwarmToNode/renderFleet are pulled out
// of main() so they're exercised in-process (the same "CLI main() run only
// via execFileSync is coverage-invisible" lesson recruiter-run.ts's/
// bakeoff-run.ts's own hardener passes already established for this
// codebase), against REAL published status.json docs on disk - never a
// hand-authored SwarmRegistration (BL-246's original design, removed by
// this ticket).

function mkTmp() {
  return mkTmpDir('sfvc-fleet-console-');
}

function publishStatus(rendezvousDir, swarmName, doc) {
  const dir = path.join(rendezvousDir, swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(doc));
}

function fixtureDoc(overrides = {}) {
  return {
    identity: { name: 'fes', project: 'free-email-scanner', kind: 'swarm', coordinatorAddress: 'fes/coordinator' },
    status: 'active',
    health: { expected_panes: 4, live_panes: 4, coordinator_alive: true },
    children: [
      { identity: { name: 'coder', project: 'free-email-scanner', kind: 'agent', coordinatorAddress: 'fes/coordinator' }, status: 'active', health: { expected_panes: 1, live_panes: 1, coordinator_alive: true } },
    ],
    needs_human: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs uses the given positional rendezvous dir when present', () => {
  assert.deepEqual(parseArgs(['/tmp/some-fleet-dir']), { rendezvousDir: '/tmp/some-fleet-dir' });
});

test('parseArgs defaults to the SWARMFORGE_FLEET_DIR env override when no positional arg is given', () => {
  assert.deepEqual(parseArgs([], { SWARMFORGE_FLEET_DIR: '/tmp/env-fleet-dir' }), { rendezvousDir: '/tmp/env-fleet-dir' });
});

test('parseArgs never fails on missing arguments - there is no required config file any more', () => {
  const result = parseArgs([], {});
  assert.equal(typeof result.rendezvousDir, 'string');
  assert.ok(result.rendezvousDir.length > 0);
});

// ── isStaleUpdatedAt ─────────────────────────────────────────────────────

test('isStaleUpdatedAt is false for a recent timestamp', () => {
  const now = Date.now();
  assert.equal(isStaleUpdatedAt(new Date(now - 1000).toISOString(), now), false);
});

test('isStaleUpdatedAt is true once the age exceeds the threshold', () => {
  const now = Date.now();
  assert.equal(isStaleUpdatedAt(new Date(now - STALE_AFTER_MS - 1000).toISOString(), now), true);
});

test('isStaleUpdatedAt is true for a malformed timestamp (never silently treated as fresh)', () => {
  assert.equal(isStaleUpdatedAt('not-a-date', Date.now()), true);
});

// ── enumeratePublishedSwarms ─────────────────────────────────────────────

test('enumeratePublishedSwarms returns one doc per published status.json', () => {
  const rendezvousDir = mkTmp();
  publishStatus(rendezvousDir, 'fes', fixtureDoc());
  publishStatus(rendezvousDir, 'primary', fixtureDoc({ identity: { name: 'primary', project: 'swarmforgevc', kind: 'swarm', coordinatorAddress: 'primary/coordinator' } }));

  const docs = enumeratePublishedSwarms(rendezvousDir);

  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.identity.name).sort(), ['fes', 'primary']);
});

test('enumeratePublishedSwarms returns an empty list when the rendezvous dir does not exist yet', () => {
  assert.deepEqual(enumeratePublishedSwarms(path.join(mkTmp(), 'does-not-exist')), []);
});

test('enumeratePublishedSwarms skips a subdir with no status.json, never crashing the whole enumeration', () => {
  const rendezvousDir = mkTmp();
  fs.mkdirSync(path.join(rendezvousDir, 'half-provisioned'), { recursive: true });
  publishStatus(rendezvousDir, 'fes', fixtureDoc());

  const docs = enumeratePublishedSwarms(rendezvousDir);

  assert.equal(docs.length, 1);
  assert.equal(docs[0].identity.name, 'fes');
});

test('enumeratePublishedSwarms skips a malformed status.json, never crashing the whole enumeration', () => {
  const rendezvousDir = mkTmp();
  fs.mkdirSync(path.join(rendezvousDir, 'corrupt'), { recursive: true });
  fs.writeFileSync(path.join(rendezvousDir, 'corrupt', 'status.json'), 'not json');
  publishStatus(rendezvousDir, 'fes', fixtureDoc());

  const docs = enumeratePublishedSwarms(rendezvousDir);

  assert.equal(docs.length, 1);
  assert.equal(docs[0].identity.name, 'fes');
});

// ── publishedSwarmToNode ─────────────────────────────────────────────────

test('publishedSwarmToNode reads identity/status/health/children purely from the doc when fresh', () => {
  const doc = fixtureDoc();
  const node = publishedSwarmToNode(doc, Date.parse(doc.updated_at) + 1000);

  assert.deepEqual(node.identity(), doc.identity);
  assert.equal(node.status(), 'active');
  assert.deepEqual(node.health(), doc.health);
  assert.equal(node.children().length, 1);
  assert.equal(node.children()[0].identity().name, 'coder');
});

test('publishedSwarmToNode overrides status to "stopped (coordinator lost)" once updated_at is stale', () => {
  const doc = fixtureDoc({ updated_at: new Date(Date.now() - STALE_AFTER_MS - 60_000).toISOString(), status: 'active' });

  const node = publishedSwarmToNode(doc, Date.now());

  assert.equal(node.status(), 'stopped (coordinator lost)');
});

// ── renderFleet (real composition over published docs) ──────────────────

test('renderFleet enumerates the rendezvous dir and renders one swarm per published status.json, with no registration file', () => {
  const rendezvousDir = mkTmp();
  publishStatus(rendezvousDir, 'fes', fixtureDoc());
  publishStatus(rendezvousDir, 'primary', fixtureDoc({ identity: { name: 'primary', project: 'swarmforgevc', kind: 'swarm', coordinatorAddress: 'primary/coordinator' } }));

  const rendered = renderFleet(rendezvousDir);

  assert.equal(rendered.identity.kind, 'fleet');
  assert.deepEqual(rendered.swarms.map((s) => s.identity.name).sort(), ['fes', 'primary']);
});

test('renderFleet renders a swarm with a stale updated_at as stopped (coordinator lost)', () => {
  const rendezvousDir = mkTmp();
  const staleDoc = fixtureDoc({ updated_at: new Date(0).toISOString(), status: 'active' });
  publishStatus(rendezvousDir, 'fes', staleDoc);

  const rendered = renderFleet(rendezvousDir, Date.now());

  assert.equal(rendered.swarms[0].status, 'stopped (coordinator lost)');
});

test('renderFleet on an empty rendezvous dir is an empty, idle fleet - never a crash', () => {
  const rendered = renderFleet(mkTmp());

  assert.equal(rendered.identity.kind, 'fleet');
  assert.deepEqual(rendered.swarms, []);
  assert.equal(rendered.status, 'idle');
});
