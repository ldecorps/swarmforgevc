const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  readRecertStore,
  writeRecertStore,
  appendRecertProposal,
  computeRecertBatch,
  parseRecertEmailTo,
  readRecertEmailTo,
  currentRecertScenarioId,
  isScenarioUpForRecert,
  recordRecertValidate,
  queueRecertAmendProposal,
  queueRecertDeleteProposal,
} = require('../out/docs/recertificationStore');

// BL-150: the impure filesystem layer for the durable recert-state.json
// store and the recert_proposals/<yyyy-MM>.jsonl queue.

function mkTmp() {
  return mkTmpDir('sfvc-recert-');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

test('readRecertStore returns an empty store when no file exists yet', () => {
  const target = mkTmp();
  const store = readRecertStore(target);
  assert.deepEqual(store.scenarios, {});
});

test('writeRecertStore then readRecertStore round-trips the same data', () => {
  const target = mkTmp();
  const store = { schemaVersion: 1, scenarios: { 'BL-096/metrics-01': { lastReviewedIso: '2026-07-01T00:00:00Z' } } };
  writeRecertStore(target, store);
  const read = readRecertStore(target);
  assert.deepEqual(read, store);
});

test('readRecertStore recovers to an empty store instead of throwing on corrupt JSON', () => {
  const target = mkTmp();
  const file = path.join(target, '.swarmforge', 'recert-state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not valid json{{{', 'utf-8');
  const store = readRecertStore(target);
  assert.deepEqual(store.scenarios, {});
});

test('readRecertStore recovers to an empty store when the file is a valid JSON value of the wrong shape', () => {
  const target = mkTmp();
  const file = path.join(target, '.swarmforge', 'recert-state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([1, 2, 3]), 'utf-8');
  const store = readRecertStore(target);
  assert.deepEqual(store.scenarios, {});
});

test('appendRecertProposal appends one jsonl line per call, in a month-bucketed file', () => {
  const target = mkTmp();
  const nowMs = Date.parse('2026-07-09T12:00:00Z');
  appendRecertProposal(target, { scenarioId: 'a', outcome: 'delete', receivedAtIso: '2026-07-09T12:00:00Z' }, nowMs);
  appendRecertProposal(target, { scenarioId: 'b', outcome: 'update', newText: 'x', receivedAtIso: '2026-07-09T12:05:00Z' }, nowMs);

  const file = path.join(target, '.swarmforge', 'recert_proposals', '2026-07.jsonl');
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
  assert.equal(lines.length, 2);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.equal(parsed[0].scenarioId, 'a');
  assert.equal(parsed[1].scenarioId, 'b');
});

test('appendRecertProposal in a different month writes a separate file', () => {
  const target = mkTmp();
  appendRecertProposal(target, { scenarioId: 'a', outcome: 'delete', receivedAtIso: '2026-06-30T23:00:00Z' }, Date.parse('2026-06-30T23:00:00Z'));
  appendRecertProposal(target, { scenarioId: 'b', outcome: 'delete', receivedAtIso: '2026-07-01T01:00:00Z' }, Date.parse('2026-07-01T01:00:00Z'));

  assert.ok(fs.existsSync(path.join(target, '.swarmforge', 'recert_proposals', '2026-06.jsonl')));
  assert.ok(fs.existsSync(path.join(target, '.swarmforge', 'recert_proposals', '2026-07.jsonl')));
});

// ── BL-223: recert_email_to (real inbound address, off the .invalid placeholder) ──

test('parseRecertEmailTo reads the configured recert_email_to', () => {
  assert.equal(
    parseRecertEmailTo('config notify_email_to a@b.com\nconfig recert_email_to recert@tolokarooo.resend.app\n'),
    'recert@tolokarooo.resend.app'
  );
});

test('parseRecertEmailTo defaults to the Resend-managed receiving domain when unconfigured', () => {
  assert.equal(parseRecertEmailTo('config notify_email_to a@b.com\n'), 'recert@tolokarooo.resend.app');
});

test('parseRecertEmailTo defaults for empty content', () => {
  assert.equal(parseRecertEmailTo(''), 'recert@tolokarooo.resend.app');
});

test('parseRecertEmailTo never defaults to the reserved .invalid TLD', () => {
  assert.doesNotMatch(parseRecertEmailTo(''), /\.invalid/);
});

test('readRecertEmailTo reads swarmforge/swarmforge.conf under the target path', () => {
  const target = mkTmp();
  mkdirp(path.join(target, 'swarmforge'));
  fs.writeFileSync(path.join(target, 'swarmforge', 'swarmforge.conf'), 'config recert_email_to recert@inbound.musicalsifu.com\n');
  assert.equal(readRecertEmailTo(target), 'recert@inbound.musicalsifu.com');
});

test('readRecertEmailTo defaults (never throws) when swarmforge.conf is missing', () => {
  const target = mkTmp();
  assert.equal(readRecertEmailTo(target), 'recert@tolokarooo.resend.app');
});

// recert-01: computeRecertBatch resolves the docs tree + durable store into
// the already oldest-first-sorted artifact the PWA renders without any
// derivation of its own.
test('computeRecertBatch selects the oldest-reviewed tagged scenario across the whole docs tree', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);

  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-900.yaml'),
    'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n\n  # BL-900 scen-02\n  Scenario: second\n    Given b\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);

  writeRecertStore(root, {
    schemaVersion: 1,
    scenarios: { 'BL-900/scen-01': { lastReviewedIso: '2026-07-01T00:00:00Z' } }, // scen-02 never reviewed
  });

  const batch = computeRecertBatch(root, 1, Date.parse('2026-07-09T00:00:00Z'));
  assert.equal(batch.batch.length, 1);
  assert.equal(batch.batch[0].id, 'BL-900/scen-02');
});

// BL-223: the published recert-batch.json is the ONE place the PWA gets the
// inbound address from - never a second hardcode alongside app.js's own.
test('computeRecertBatch includes recertEmailTo, defaulting to the Resend-managed receiving domain', () => {
  const root = mkTmp();
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, '.swarmforge'));
  const batch = computeRecertBatch(root, 1, Date.parse('2026-07-09T00:00:00Z'));
  assert.equal(batch.recertEmailTo, 'recert@tolokarooo.resend.app');
});

test('computeRecertBatch reflects a configured recert_email_to override (future custom-domain swap)', () => {
  const root = mkTmp();
  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, '.swarmforge'));
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config recert_email_to recert@inbound.musicalsifu.com\n');
  const batch = computeRecertBatch(root, 1, Date.parse('2026-07-09T00:00:00Z'));
  assert.equal(batch.recertEmailTo, 'recert@inbound.musicalsifu.com');
});

function mkGenerateRecertBatchFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);

  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-901.yaml'),
    'id: BL-901\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-901 scen-01\n  Scenario: only one\n    Given a\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  return root;
}

// ── BL-450: the standing Recert topic's own first live writers ───────────
// Reuses mkGenerateRecertBatchFixture's own shape: one ticket, one tagged
// scenario "BL-901/scen-01", never reviewed - the current oldest (and only)
// scenario up for recertification.

const NOW_MS = Date.parse('2026-07-16T12:00:00Z');

test('currentRecertScenarioId returns the oldest-unreviewed scenario id', () => {
  const root = mkGenerateRecertBatchFixture();
  assert.equal(currentRecertScenarioId(root, NOW_MS), 'BL-901/scen-01');
});

test('currentRecertScenarioId returns undefined when nothing needs recertification', () => {
  const root = mkTmp();
  assert.equal(currentRecertScenarioId(root, NOW_MS), undefined);
});

test('isScenarioUpForRecert is true for the current oldest scenario and false for any other id', () => {
  const root = mkGenerateRecertBatchFixture();
  assert.equal(isScenarioUpForRecert(root, 'BL-901/scen-01', NOW_MS), true);
  assert.equal(isScenarioUpForRecert(root, 'BL-999-ghost-01', NOW_MS), false);
});

test('recordRecertValidate advances the scenario\'s last-reviewed timestamp when it is up for recert', () => {
  const root = mkGenerateRecertBatchFixture();
  const applied = recordRecertValidate(root, 'BL-901/scen-01', NOW_MS);
  assert.equal(applied, true);
  const store = readRecertStore(root);
  assert.equal(store.scenarios['BL-901/scen-01'].lastReviewedIso, new Date(NOW_MS).toISOString());
});

// Break-then-fix (engineering BL-383 disk-input rule): confirms the write
// really lands on disk, not merely that the pure confirmScenario logic ran.
test('recordRecertValidate\'s write is load-bearing - the store on disk actually changes', () => {
  const root = mkGenerateRecertBatchFixture();
  const before = readRecertStore(root);
  assert.equal(before.scenarios['BL-901/scen-01'], undefined);

  recordRecertValidate(root, 'BL-901/scen-01', NOW_MS);

  const after = readRecertStore(root);
  assert.notEqual(after.scenarios['BL-901/scen-01'], undefined);
  assert.equal(after.scenarios['BL-901/scen-01'].lastReviewedIso, new Date(NOW_MS).toISOString());
});

test('recordRecertValidate applies nothing and returns false for a scenario not currently up for recert', () => {
  const root = mkGenerateRecertBatchFixture();
  const applied = recordRecertValidate(root, 'BL-999-ghost-01', NOW_MS);
  assert.equal(applied, false);
  assert.deepEqual(readRecertStore(root).scenarios, {});
});

test('queueRecertAmendProposal queues an "update" proposal carrying the new text, and returns true', () => {
  const root = mkGenerateRecertBatchFixture();
  const queued = queueRecertAmendProposal(root, 'BL-901/scen-01', 'Given a revised precondition', NOW_MS);
  assert.equal(queued, true);

  const file = path.join(root, '.swarmforge', 'recert_proposals', '2026-07.jsonl');
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
  assert.equal(lines.length, 1);
  const proposal = JSON.parse(lines[0]);
  assert.equal(proposal.scenarioId, 'BL-901/scen-01');
  assert.equal(proposal.outcome, 'update');
  assert.equal(proposal.newText, 'Given a revised precondition');
});

test('queueRecertAmendProposal queues nothing and returns false for a scenario not currently up for recert', () => {
  const root = mkGenerateRecertBatchFixture();
  const queued = queueRecertAmendProposal(root, 'BL-999-ghost-01', 'anything', NOW_MS);
  assert.equal(queued, false);
  assert.ok(!fs.existsSync(path.join(root, '.swarmforge', 'recert_proposals', '2026-07.jsonl')));
});

test('queueRecertDeleteProposal queues a "delete" proposal with no newText, and returns true', () => {
  const root = mkGenerateRecertBatchFixture();
  const queued = queueRecertDeleteProposal(root, 'BL-901/scen-01', NOW_MS);
  assert.equal(queued, true);

  const file = path.join(root, '.swarmforge', 'recert_proposals', '2026-07.jsonl');
  const proposal = JSON.parse(fs.readFileSync(file, 'utf-8').trim());
  assert.equal(proposal.scenarioId, 'BL-901/scen-01');
  assert.equal(proposal.outcome, 'delete');
  assert.equal(proposal.newText, undefined);
});

test('queueRecertDeleteProposal queues nothing and returns false for a scenario not currently up for recert', () => {
  const root = mkGenerateRecertBatchFixture();
  const queued = queueRecertDeleteProposal(root, 'BL-999-ghost-01', NOW_MS);
  assert.equal(queued, false);
  assert.ok(!fs.existsSync(path.join(root, '.swarmforge', 'recert_proposals', '2026-07.jsonl')));
});

test('after validating the current oldest scenario, the queue advances to the next-oldest scenario', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-902.yaml'),
    'id: BL-902\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-902 scen-01\n  Scenario: first\n    Given a\n\n  # BL-902 scen-02\n  Scenario: second\n    Given b\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);

  assert.equal(currentRecertScenarioId(root, NOW_MS), 'BL-902/scen-01');
  recordRecertValidate(root, 'BL-902/scen-01', NOW_MS);
  assert.equal(currentRecertScenarioId(root, NOW_MS), 'BL-902/scen-02', 'expected the just-validated scenario to leave the front of the queue');
});
