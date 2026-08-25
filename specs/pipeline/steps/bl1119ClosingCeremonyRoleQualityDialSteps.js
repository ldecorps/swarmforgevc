'use strict';

// BL-1119: closing ceremony recommends per-role quality dial from lean
// ledger signals. Drives REAL closingCeremony / closingCeremonyStore —
// recommend only; never rewrite pack conf.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'BL-1119 closing ceremony recommends per-role quality dial';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');

const { buildClosingCeremonyPacket } = require(path.join(EXT_DIR, 'out', 'quality', 'closingCeremony'));
const {
  writeCeremonyRun,
  readCeremonyRun,
  recordCeremonyOutcome,
} = require(path.join(EXT_DIR, 'out', 'metrics', 'closingCeremonyStore'));

const SHIFT = '2026-08-25';

function mkTarget(ctx) {
  if (ctx.bl1119?.target) {
    return ctx.bl1119;
  }
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1119-'));
  fs.mkdirSync(path.join(target, '.swarmforge', 'lean', 'ceremony'), { recursive: true });
  const packsDir = path.join(target, 'swarmforge', 'packs');
  fs.mkdirSync(packsDir, { recursive: true });
  const packConf = path.join(packsDir, 'demo.conf');
  fs.writeFileSync(packConf, 'window_model=opus\neffort=high\n');
  ctx.bl1119 = {
    target,
    packConf,
    packBefore: fs.readFileSync(packConf, 'utf8'),
    role: null,
    leanSignal: null,
    windowModels: {},
  };
  return ctx.bl1119;
}

function eventsForSignal(leanSignal) {
  if (leanSignal === 'elevated bounces or stalls') {
    return [
      {
        ticket: 'BL-1119A',
        type: 'stall',
        source: 'chaser-telemetry',
        at: `${SHIFT}T10:00:00.000Z`,
        role: 'coder',
        data: { eventType: 'chase', count: 2 },
      },
    ];
  }
  if (leanSignal === 'clean closes without rework') {
    return [
      {
        ticket: 'BL-1119B',
        type: 'stage_transition',
        source: 'stage-dwell',
        at: `${SHIFT}T10:00:00.000Z`,
        role: 'cleaner',
        data: { processingMs: 500 },
      },
    ];
  }
  throw new Error(`unknown lean_signal: ${leanSignal}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a finished shift whose lean ledger shows (.+) for one pipeline role$/, (ctx, leanSignal) => {
    const st = mkTarget(ctx);
    st.leanSignal = leanSignal;
    st.events = eventsForSignal(leanSignal);
    st.role = st.events[0].role;
  });

  scoped(/^that role's window model is a concrete non-auto model$/, (ctx) => {
    const st = mkTarget(ctx);
    st.windowModels = { [st.role]: 'opus' };
  });

  scoped(/^that role's window model is (auto|cursor\/auto|copilot\/auto)$/, (ctx, model) => {
    const st = mkTarget(ctx);
    st.windowModels = { [st.role]: model };
  });

  scoped(/^the closing-ceremony packet is built$/, (ctx) => {
    const st = mkTarget(ctx);
    st.packet = buildClosingCeremonyPacket(SHIFT, st.events, st.windowModels || {});
  });

  scoped(/^that role receives a quality (.+) recommendation$/, (ctx, dialText) => {
    const st = mkTarget(ctx);
    const rec = st.packet.qualityRecommendations.find((r) => r.role === st.role);
    assert.ok(rec, `expected a recommendation for ${st.role}, got ${JSON.stringify(st.packet.qualityRecommendations)}`);
    if (dialText === 'raise') {
      assert.equal(rec.dial, 'raise');
    } else if (dialText === 'lower or hold') {
      assert.ok(rec.dial === 'lower' || rec.dial === 'hold', `expected lower|hold, got ${rec.dial}`);
    } else if (dialText === 'hold or skip') {
      assert.equal(rec.dial, 'hold');
      assert.ok(rec.disposition === 'held' || rec.disposition === 'skipped', `got disposition ${rec.disposition}`);
    } else {
      throw new Error(`unknown dial text: ${dialText}`);
    }
    st.rec = rec;
  });

  scoped(/^the recommendation cites the lean ledger fields used$/, (ctx) => {
    const st = mkTarget(ctx);
    assert.ok(st.rec.citedFields.length > 0, 'expected citedFields');
    assert.ok(
      st.rec.citedFields.some((f) => f === 'stalls' || f === 'bounce.blamedRole'),
      `expected stalls or bounce.blamedRole in ${JSON.stringify(st.rec.citedFields)}`
    );
  });

  scoped(/^pack conf window model and effort lines stay unchanged$/, (ctx) => {
    const st = mkTarget(ctx);
    assert.equal(fs.readFileSync(st.packConf, 'utf8'), st.packBefore);
  });

  scoped(/^the packet does not recommend changing that role's model or effort$/, (ctx) => {
    const st = mkTarget(ctx);
    const rec = st.packet.qualityRecommendations.find((r) => r.role === st.role);
    assert.ok(rec);
    assert.notEqual(rec.dial, 'raise');
    assert.notEqual(rec.dial, 'lower');
    assert.equal(fs.readFileSync(st.packConf, 'utf8'), st.packBefore);
  });

  scoped(/^a ceremony packet that recommends a quality change for a role$/, (ctx) => {
    const st = mkTarget(ctx);
    const packet = buildClosingCeremonyPacket(SHIFT, eventsForSignal('elevated bounces or stalls'), {
      coder: 'opus',
    });
    assert.ok(packet.qualityRecommendations.some((r) => r.dial === 'raise'));
    writeCeremonyRun(st.target, {
      shiftKey: SHIFT,
      packet,
      deliveredAt: `${SHIFT}T20:00:00.000Z`,
      outcome: null,
      adjustments: [],
      failedAt: null,
    });
    st.packet = packet;
  });

  scoped(/^the specifier records a lean outcome of no_change for that shift$/, (ctx) => {
    const st = mkTarget(ctx);
    st.run = recordCeremonyOutcome(st.target, SHIFT, {
      type: 'no_change',
      ref: null,
      recordedAt: `${SHIFT}T21:00:00.000Z`,
    });
  });

  scoped(/^the recommendation is recorded as refused or held$/, (ctx) => {
    const st = mkTarget(ctx);
    const run = readCeremonyRun(st.target, SHIFT);
    assert.ok(run);
    for (const r of run.packet.qualityRecommendations) {
      assert.ok(r.disposition === 'refused' || r.disposition === 'held', `got ${r.disposition}`);
    }
  });

  scoped(/^no pack conf rewrite is applied$/, (ctx) => {
    const st = mkTarget(ctx);
    assert.equal(fs.readFileSync(st.packConf, 'utf8'), st.packBefore);
  });
}

module.exports = { registerSteps };
