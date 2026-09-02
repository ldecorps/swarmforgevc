'use strict';

// BL-1319: the optimizer's dwell instrument names the STAGE, never a seat.
//
// BL-983 declared that seat identity never escapes the mailbox layer, and
// BL-1040 closed the board and stage-map half. `stageDwell.ts` was still
// open, and the live shape is worse than a mislabelled row:
// `computeStageDwellReportForRoles` filters on PIPELINE_ORDER, which holds
// bare stage names only, so a non-bare seat used to fail that filter and be
// DROPPED - the stage reported as though the seat's parcels never happened.
// An understated stage can then be ranked below a single-seat stage that is
// actually faster, which is a wrong optimizer answer, not a cosmetic label.
//
// Every scenario EXECUTES the real compiled instrument over a real on-disk
// mailbox fixture. A source-text assertion cannot tell a wired fold from a
// dead one, which is exactly the fault under review.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'BL-1319 stage-dwell and bottleneck naming key on the stage, never on a seat';
const OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');

const {
  computeStageDwellReportForRoles,
  computeSeatDwellDetail,
  readRoleStageDwellRecords,
} = require(path.join(OUT, 'metrics', 'stageDwell'));

const STAGE = 'coder';
const SECOND_SEAT = 'coder@sonnet2';
const NOW = Date.parse('2026-07-09T12:00:00Z');
const BASE = Date.parse('2026-07-09T08:00:00Z');

// Minutes per parcel. The bare seat is fast and the second seat slow, so the
// coder stage is understated exactly while the second seat is dropped: with
// only the bare seat it reports 1 min and loses to cleaner's 15; whole, its
// median is 15.5 and it wins. The fold is what decides the answer.
const FAST_MIN = 1;
const SLOW_MIN = 30;
const CLEANER_MIN = 15;

function iso(ms) {
  return new Date(ms).toISOString();
}

function writeParcel(worktree, name, minutes) {
  const dir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `00_${name}.handoff`),
    `task: BL-9${name}-fixture\ndequeued_at: ${iso(BASE)}\ncompleted_at: ${iso(BASE + minutes * 60000)}\n\nbody\n`
  );
}

function seatEntry(root, role, dirName, agent) {
  return {
    role,
    worktreeName: dirName,
    worktreePath: path.join(root, dirName),
    agent,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^a swarm whose coder stage runs the seats "([^"]+)" and "([^"]+)"$/, (ctx, bare, second) => {
    // Explicit KNOWN_VALUES rather than passthrough: the Background names the
    // exact two seats this feature is about, and a different pair would be a
    // different fixture silently accepted.
    assert.equal(bare, STAGE, `unexpected bare seat "${bare}"`);
    assert.equal(second, SECOND_SEAT, `unexpected second seat "${second}"`);
    ctx.cleanups = ctx.cleanups ?? [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1319-dwell-'));
    ctx.cleanups.push(root);
    ctx.bl1319 = {
      root,
      roles: [
        seatEntry(root, STAGE, 'wt-coder', 'claude'),
        seatEntry(root, SECOND_SEAT, 'wt-coder2', 'aider'),
      ],
    };
  });

  scoped(/^every other stage runs exactly one bare seat$/, (ctx) => {
    const { root } = ctx.bl1319;
    ctx.bl1319.roles.push(seatEntry(root, 'cleaner', 'wt-cleaner', 'claude'));
    writeParcel(path.join(root, 'wt-cleaner'), 'cleaner1', CLEANER_MIN);
    for (const role of ['specifier', 'architect', 'hardender', 'documenter', 'QA']) {
      ctx.bl1319.roles.push(seatEntry(root, role, `wt-${role}`, 'claude'));
    }
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^each coder seat has completed parcels of its own$/, (ctx) => {
    const { root } = ctx.bl1319;
    writeParcel(path.join(root, 'wt-coder'), 'bare1', FAST_MIN);
    writeParcel(path.join(root, 'wt-coder'), 'bare2', FAST_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat1', SLOW_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat2', SLOW_MIN);
  });

  scoped(/^the slowest processing belongs to the non-bare coder seat$/, (ctx) => {
    const { root } = ctx.bl1319;
    writeParcel(path.join(root, 'wt-coder'), 'bare1', FAST_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat1', SLOW_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat2', SLOW_MIN);
  });

  scoped(/^the coder seats together process slower than every single-seat stage$/, (ctx) => {
    const { root } = ctx.bl1319;
    writeParcel(path.join(root, 'wt-coder'), 'bare1', FAST_MIN);
    writeParcel(path.join(root, 'wt-coder'), 'bare2', FAST_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat1', SLOW_MIN);
    writeParcel(path.join(root, 'wt-coder2'), 'seat2', SLOW_MIN);
    // Honest fixture: with the second seat dropped, cleaner genuinely IS the
    // bottleneck. The fold is what changes the answer, not the arithmetic.
    const bareOnly = ctx.bl1319.roles.filter((r) => r.role !== SECOND_SEAT);
    assert.equal(
      computeStageDwellReportForRoles(bareOnly, NOW, 24).bottleneck.role,
      'cleaner',
      'the fixture must be one where dropping the seat really does mis-name the bottleneck'
    );
  });

  // NOTE: the feature's scenario 03 also asks that neither coder seat ALONE
  // process slower than the slowest single-seat stage. That is unsatisfiable
  // under median ranking - a combined median can never exceed both seats'
  // medians - so this step asserts what the fixture can honestly establish:
  // the seat that is slow alone is the one whose loss understated the stage.
  // Raised to the specifier as a spec gap rather than quietly encoded.
  scoped(/^neither coder seat alone processes slower than the slowest single-seat stage$/, (ctx) => {
    const seats = computeSeatDwellDetail(ctx.bl1319.roles, NOW, 24);
    const bare = seats.find((s) => s.seat === STAGE);
    assert.ok(
      bare.processing.medianMs < CLEANER_MIN * 60000,
      'the bare seat alone must not be the bottleneck - that is what made the drop invisible'
    );
  });

  scoped(/^the coder stage runs only the bare seat "([^"]+)"$/, (ctx, bare) => {
    assert.equal(bare, STAGE, `unexpected bare seat "${bare}"`);
    ctx.bl1319.roles = ctx.bl1319.roles.filter((r) => r.role !== SECOND_SEAT);
    writeParcel(path.join(ctx.bl1319.root, 'wt-coder'), 'bare1', FAST_MIN);
    writeParcel(path.join(ctx.bl1319.root, 'wt-coder'), 'bare2', FAST_MIN);
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the stage-dwell report is computed$/, (ctx) => {
    ctx.bl1319.result = computeStageDwellReportForRoles(ctx.bl1319.roles, NOW, 24);
  });

  scoped(/^the bottleneck is named$/, (ctx) => {
    ctx.bl1319.result = computeStageDwellReportForRoles(ctx.bl1319.roles, NOW, 24);
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^exactly one dwell row exists for the coder stage$/, (ctx) => {
    const rows = ctx.bl1319.result.stages.filter((s) => s.role === STAGE);
    assert.equal(rows.length, 1);
  });

  scoped(/^that row accounts for the parcels of both seats$/, (ctx) => {
    const row = ctx.bl1319.result.stages.find((s) => s.role === STAGE);
    assert.equal(row.parcelsProcessed, 4, "the second seat's parcels must be merged in, never dropped");
  });

  scoped(/^the bottleneck is reported as "([^"]+)"$/, (ctx, expected) => {
    assert.equal(expected, STAGE, `unexpected expected bottleneck "${expected}"`);
    assert.equal(ctx.bl1319.result.bottleneck.role, expected);
  });

  scoped(/^no reported stage name or bottleneck name contains an "@"$/, (ctx) => {
    for (const s of ctx.bl1319.result.stages) {
      assert.ok(!s.role.includes('@'), `stage row leaked a seat id: ${s.role}`);
    }
    assert.ok(!ctx.bl1319.result.bottleneck.role.includes('@'));
    assert.ok(!JSON.stringify(ctx.bl1319.result).includes('@'), 'the served payload must carry no seat id');
  });

  scoped(/^the underlying dwell records still attribute each parcel to the seat that worked it$/, (ctx) => {
    for (const entry of ctx.bl1319.roles) {
      const { records } = readRoleStageDwellRecords(entry, 0, NOW);
      for (const record of records) {
        assert.equal(record.role, entry.role, 'a record must name its own seat, never the folded stage');
      }
    }
    // And the sanctioned ops surface renders that detail, seat and model.
    const seats = computeSeatDwellDetail(ctx.bl1319.roles, NOW, 24);
    const second = seats.find((s) => s.seat === SECOND_SEAT);
    assert.equal(second.stage, STAGE);
    assert.equal(second.agent, 'aider');
    assert.equal(second.parcelsProcessed, 2);
  });

  scoped(/^the report is identical to the pre-fold output for the same parcels$/, (ctx) => {
    const result = ctx.bl1319.result;
    // Pre-fold behaviour for a bare-only roster: one row per configured
    // stage, keyed exactly as roles.tsv spells it and in roster order, each
    // carrying only its own parcels. The Background configures every other
    // stage too, so they appear with zero parcels exactly as before.
    assert.deepEqual(
      result.stages.map((s) => s.role),
      ctx.bl1319.roles.map((r) => r.role)
    );
    assert.equal(result.stages.find((s) => s.role === STAGE).parcelsProcessed, 2);
    assert.equal(result.stages.find((s) => s.role === 'cleaner').parcelsProcessed, 1);
    assert.deepEqual(computeStageDwellReportForRoles(ctx.bl1319.roles, NOW, 24), result);
  });
}

module.exports = { registerSteps };
