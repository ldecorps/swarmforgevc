'use strict';

// BL-1186: step handlers for "Deprecator scan identifies unused or
// seldom-used surfaces and notifies the human". Drives the REAL
// runDeprecatorIdentifyUnusedScan (extension/out/tools/deprecate-identify-unused.js,
// compiled from extension/src/tools/deprecate-identify-unused.ts) against a
// real fixture filesystem - no mocked I/O - same established pattern as
// bl1173DeprecatorFreshnessGateCliSteps.js (this file's sibling).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'Deprecator scan identifies unused or seldom-used surfaces and notifies the human';
const REPO = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO, 'extension');
const { runDeprecatorIdentifyUnusedScan } = require(path.join(EXT, 'out', 'tools', 'deprecate-identify-unused'));

function ensure(ctx) {
  if (!ctx.bl1186) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1186-aps-'));
    fs.mkdirSync(path.join(root, '.swarmforge', 'deprecator'), { recursive: true });
    fs.writeFileSync(path.join(root, '.swarmforge', 'deprecator', 'usage-ledger.json'), '[]');
    ctx.bl1186 = { root, ledger: [] };
  }
  return ctx.bl1186;
}

function writeLedger(st) {
  fs.writeFileSync(
    path.join(st.root, '.swarmforge', 'deprecator', 'usage-ledger.json'),
    JSON.stringify(st.ledger)
  );
}

function runScan(st) {
  st.confFile = path.join(st.root, 'swarmforge', 'swarmforge.conf');
  fs.mkdirSync(path.dirname(st.confFile), { recursive: true });
  if (!fs.existsSync(st.confFile)) {
    fs.writeFileSync(st.confFile, 'active_backlog_max_depth\t6\n');
  }
  st.confBefore = fs.readFileSync(st.confFile, 'utf8');
  st.report = runDeprecatorIdentifyUnusedScan(st.root, '2026-08-28T00:00:00.000Z');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the deprecator usage ledger is available for the target swarm root$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^conf key "([^"]+)" has zero hits in the last "(\d+)" days$/, (ctx, surface) => {
    const st = ensure(ctx);
    st.ledger.push({ surface, hits90d: 0 });
    writeLedger(st);
  });

  scoped(/^operator verb "([^"]+)" has "(\d+)" hits in the last "(\d+)" days$/, (ctx, surface, hits) => {
    const st = ensure(ctx);
    st.ledger.push({ surface, hits90d: Number(hits) });
    writeLedger(st);
  });

  scoped(/^module "([^"]+)" has "(\d+)" hits in the last "(\d+)" days$/, (ctx, surface, hits) => {
    const st = ensure(ctx);
    st.ledger.push({ surface, hits90d: Number(hits) });
    writeLedger(st);
  });

  scoped(/^the scan finds at least one unused or seldom candidate$/, (ctx) => {
    const st = ensure(ctx);
    st.ledger.push({ surface: 'legacy.chase.enabled', hits90d: 0 });
    writeLedger(st);
  });

  scoped(/^the deprecator identify-unused scan runs$/, (ctx) => {
    runScan(ensure(ctx));
  });

  scoped(/^the deprecator identify-unused scan completes$/, (ctx) => {
    runScan(ensure(ctx));
  });

  scoped(/^the report lists "([^"]+)" as class "([^"]+)"$/, (ctx, surface, cls) => {
    const st = ensure(ctx);
    const candidate = st.report.candidates.find((c) => c.surface === surface);
    assert.ok(candidate, `expected a candidate for "${surface}", got: ${JSON.stringify(st.report.candidates)}`);
    assert.equal(candidate.class, cls);
  });

  scoped(/^the report does not mutate any live configuration$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.readFileSync(st.confFile, 'utf8'), st.confBefore);
  });

  scoped(/^the report includes the hit count "(\d+)"$/, (ctx, hits) => {
    const st = ensure(ctx);
    assert.ok(
      st.report.candidates.some((c) => c.hits === Number(hits)),
      `expected a candidate with hits=${hits}, got: ${JSON.stringify(st.report.candidates)}`
    );
  });

  scoped(/^a human-visible notification is queued naming each candidate and its class$/, (ctx) => {
    const st = ensure(ctx);
    const dir = path.join(st.root, '.swarmforge', 'deprecator', 'pending-notifications');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.equal(files.length, 1, `expected exactly one queued notification, got: ${JSON.stringify(files)}`);
    const queued = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    for (const candidate of st.report.candidates) {
      assert.ok(
        queued.candidates.some((c) => c.surface === candidate.surface && c.class === candidate.class),
        `expected the queued notification to name ${candidate.surface} (${candidate.class})`
      );
    }
  });

  scoped(/^no ticket is closed and no code is removed automatically$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(fs.existsSync(path.join(st.root, 'backlog', 'done')), false);
  });

  scoped(/^the report does not list "([^"]+)"$/, (ctx, surface) => {
    const st = ensure(ctx);
    assert.ok(
      !st.report.candidates.some((c) => c.surface === surface),
      `expected no candidate for "${surface}", got: ${JSON.stringify(st.report.candidates)}`
    );
  });
}

module.exports = { registerSteps };
