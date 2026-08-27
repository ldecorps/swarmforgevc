'use strict';

// BL-942: step handlers for "a deferred hardening gate leaves a durable
// debt record". Drives the real swarmforge/scripts/hardening_debt_ledger_
// update.bb (--defer) and hardening_debt_ledger_read.bb - never a
// reimplementation of the ledger's dedup or read logic. "A hardening pass"
// is simulated at the level this ticket owns: the RECORDING call a
// hardening pass makes when it takes the office-hours bypass (or omits when
// the gate ran) - not a full live hardener role run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DEFER_CLI = path.join(SCRIPTS_DIR, 'hardening_debt_ledger_update.bb');
const READ_CLI = path.join(SCRIPTS_DIR, 'hardening_debt_ledger_read.bb');

const FEATURE = 'a deferred hardening gate leaves a durable debt record';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  return root;
}

let seq = 0;
function rid(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function defer(root, { parcel, gate, fileSet, reason, load }) {
  execFileSync('bb', [DEFER_CLI, root, '--defer', parcel, gate, fileSet.join(','), reason, load, '2026-08-19'], {
    encoding: 'utf8',
  });
}

function readAll(root) {
  const out = execFileSync('bb', [READ_CLI, root], { encoding: 'utf8' });
  return JSON.parse(out);
}

function readParcel(root, parcel) {
  const out = execFileSync('bb', [READ_CLI, root, '--parcel', parcel], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a hardening pass on a parcel with a wired mutation target$/,
    (ctx) => {
      ctx.root = mkTmp('sfvc-bl942-');
      ctx.parcel = rid('BL-PARCEL');
      ctx.fileSet = ['extension/src/quality/closingCeremony.ts', 'extension/src/concierge/epicIcon.ts'];
      ctx.reason = 'host load above busy threshold';
      ctx.load = '44.47/27.77/22.49';
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^the (mutation|CRAP) gate is blocked by host load above the busy threshold$/,
    (ctx, gate) => {
      ctx.gate = gate;
      ctx.deferred = true;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the hardening pass completes and forwards the parcel$/,
    (ctx) => {
      if (ctx.deferred) {
        defer(ctx.root, { parcel: ctx.parcel, gate: ctx.gate, fileSet: ctx.fileSet, reason: ctx.reason, load: ctx.load });
      }
      // A gate that ran makes no --defer call at all - nothing to record.
    },
    FEATURE
  );

  registry.defineScoped(
    /^the debt ledger holds a row for that parcel and gate$/,
    (ctx) => {
      const rows = readParcel(ctx.root, ctx.parcel);
      ctx.row = rows.find((r) => r.gate === ctx.gate);
      assert.ok(ctx.row, `expected a row for parcel ${ctx.parcel} gate ${ctx.gate}, got: ${JSON.stringify(rows)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the row names the file set that was skipped$/,
    (ctx) => {
      assert.deepEqual(ctx.row.file_set, [...ctx.fileSet].sort());
    },
    FEATURE
  );

  registry.defineScoped(
    /^the row records the load measurement that justified the skip$/,
    (ctx) => {
      assert.equal(ctx.row.load, ctx.load);
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the mutation gate runs to completion against a quiet host$/,
    (ctx) => {
      ctx.gate = 'mutation';
      ctx.deferred = false;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the debt ledger holds no row for that parcel$/,
    (ctx) => {
      const rows = readParcel(ctx.root, ctx.parcel);
      assert.deepEqual(rows, []);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the debt ledger already holds a mutation row for a file set$/,
    (ctx) => {
      ctx.root = mkTmp('sfvc-bl942-');
      ctx.fileSet = ['a/one.ts', 'a/two.ts'];
      ctx.firstParcel = rid('BL-FIRST');
      defer(ctx.root, { parcel: ctx.firstParcel, gate: 'mutation', fileSet: ctx.fileSet, reason: 'host load above busy threshold', load: '44.47/27.77/22.49' });
    },
    FEATURE
  );

  registry.defineScoped(
    /^another hardening pass defers the mutation gate for that same file set$/,
    (ctx) => {
      ctx.secondParcel = rid('BL-SECOND');
      // Same gate + file set (shuffled order), a DIFFERENT parcel - the
      // exact redelivery shape the dedup key must collapse (BL-654
      // invariant, not just this one acceptance example).
      defer(ctx.root, {
        parcel: ctx.secondParcel,
        gate: 'mutation',
        fileSet: [...ctx.fileSet].reverse(),
        reason: 'host load above busy threshold',
        load: '50/40/30',
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the debt ledger still holds exactly one row for that file set$/,
    (ctx) => {
      const rows = readAll(ctx.root).filter((r) => JSON.stringify([...r.file_set].sort()) === JSON.stringify([...ctx.fileSet].sort()));
      assert.equal(rows.length, 1, `expected exactly one row for ${JSON.stringify(ctx.fileSet)}, got: ${JSON.stringify(rows)}`);
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the debt ledger holds rows from earlier deferrals$/,
    (ctx) => {
      ctx.root = mkTmp('sfvc-bl942-');
      ctx.deferrals = [
        { parcel: rid('BL-READ'), gate: 'mutation', fileSet: ['x/one.ts'], reason: 'host load above busy threshold', load: '44/27/22' },
        { parcel: rid('BL-READ'), gate: 'CRAP', fileSet: ['x/two.ts', 'x/three.ts'], reason: 'host load above busy threshold', load: '60/50/40' },
      ];
      for (const d of ctx.deferrals) defer(ctx.root, d);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the outstanding debt is read through the ledger's own reader$/,
    (ctx) => {
      ctx.readBack = readAll(ctx.root);
    },
    FEATURE
  );

  registry.defineScoped(
    /^each parcel and its skipped file set are returned$/,
    (ctx) => {
      for (const d of ctx.deferrals) {
        const row = ctx.readBack.find((r) => r.parcel === d.parcel);
        assert.ok(row, `expected a row for ${d.parcel}, got: ${JSON.stringify(ctx.readBack)}`);
        assert.deepEqual(row.file_set, [...d.fileSet].sort());
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no evidence markdown file is consulted to produce that answer$/,
    (ctx) => {
      // Structural proof: this fixture root never had a backlog/evidence
      // directory at all, and the reader still produced the right answer -
      // it cannot have consulted evidence prose that does not exist.
      assert.equal(fs.existsSync(path.join(ctx.root, 'backlog', 'evidence')), false);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
