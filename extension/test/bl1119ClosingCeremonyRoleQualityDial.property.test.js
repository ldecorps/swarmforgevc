'use strict';

// BL-1119 declared invariants (coder first authorship — BL-654):
//
// 1. Quality dial recommendations never silently rewrite pack conf —
//    recommend only.
// 2. Signals for well vs rework come only from existing lean ledger fields
//    (BL-819/820), never a parallel metric store.
// 3. Roles whose window model is auto (auto, cursor/auto, copilot/auto, …)
//    never receive raise/lower — hold/skip only; covers the wired
//    runClosingCeremony path (architect bounce D1).
//
// Non-vacuity: (1) assert pack bytes change → RED when we deliberately
// rewrite; (2) inject unknown cited field → RED; (3) omit windowModels on
// stall → raise RED vs hold. Restored. Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { recordCeremonyOutcome } = require('../out/metrics/closingCeremonyStore');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');
const {
  buildClosingCeremonyPacket,
  isAutoWindowModel,
  KNOWN_QUALITY_CITED_FIELDS,
} = require('../out/quality/closingCeremony');

const AUTO_MODELS = ['auto', 'cursor/auto', 'copilot/auto'];
const LEAN_FIELDS = new Set(KNOWN_QUALITY_CITED_FIELDS);

function mkTargetWithPack(model) {
  const target = mkTmpDir('sfvc-bl1119-prop-');
  const packs = path.join(target, 'swarmforge', 'packs');
  fs.mkdirSync(packs, { recursive: true });
  const packConf = path.join(packs, 'demo.conf');
  const body = `window coder cursor coder --model ${model}\neffort=high\n`;
  fs.writeFileSync(packConf, body);
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${packConf}\n`
  );
  return { target, packConf, packBefore: body };
}

function stallEvent(at) {
  return {
    ticket: 'BL-1119',
    type: 'stall',
    source: 'chaser-telemetry',
    at,
    role: 'coder',
    data: { eventType: 'chase', count: 1 },
  };
}

test('BL-1119/BL-654 invariant 1: ceremony + no_change never mutates pack conf bytes', () => {
  fc.assert(
    fc.property(fc.constantFrom(...AUTO_MODELS, 'opus'), (model) => {
      const { target, packConf, packBefore } = mkTargetWithPack(model);
      appendLeanLedgerEventIfNew(target, stallEvent('2026-08-08T09:00:00.000Z'));
      const deps = { sendNote: () => {} };
      runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
      recordCeremonyOutcome(target, '2026-08-08', {
        type: 'no_change',
        ref: null,
        recordedAt: '2026-08-08T23:00:00.000Z',
      });
      assert.equal(fs.readFileSync(packConf, 'utf8'), packBefore);
    }),
    { numRuns: 12 }
  );
});

test('BL-1119/BL-654 invariant 2: citedFields stay in lean ledger vocabulary', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('stall', 'bounce', 'stage_transition'),
      fc.constantFrom(...AUTO_MODELS, 'opus', undefined),
      (signal, model) => {
        const events = [];
        if (signal === 'stall') {
          events.push(stallEvent('2026-08-08T10:00:00.000Z'));
        } else if (signal === 'bounce') {
          events.push({
            ticket: 'BL-1119',
            type: 'bounce',
            source: 'bounce-store',
            at: '2026-08-08T10:00:00.000Z',
            data: { blamedRole: 'architect', failureClass: 'behavior' },
          });
        } else {
          events.push({
            ticket: 'BL-1119',
            type: 'stage_transition',
            source: 'stage-dwell',
            at: '2026-08-08T10:00:00.000Z',
            role: 'cleaner',
            data: { processingMs: 100 },
          });
        }
        const windowModels = model ? { coder: model, architect: model, cleaner: model } : {};
        const packet = buildClosingCeremonyPacket('2026-08-08', events, windowModels);
        for (const rec of packet.qualityRecommendations) {
          for (const f of rec.citedFields) {
            assert.ok(LEAN_FIELDS.has(f), `unexpected cited field ${f}`);
          }
        }
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1119/BL-654 invariant 3: auto models hold on wired runClosingCeremony path', () => {
  let draws = 0;
  fc.assert(
    fc.property(fc.constantFrom(...AUTO_MODELS), (model) => {
      draws += 1;
      assert.equal(isAutoWindowModel(model), true);
      const { target } = mkTargetWithPack(model);
      appendLeanLedgerEventIfNew(target, stallEvent('2026-08-08T09:00:00.000Z'));
      const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', { sendNote: () => {} });
      const rec = result.run.packet.qualityRecommendations.find((r) => r.role === 'coder');
      assert.ok(rec);
      assert.equal(rec.dial, 'hold');
      assert.notEqual(rec.dial, 'raise');
      assert.notEqual(rec.dial, 'lower');
      assert.equal(rec.disposition, 'held');
    }),
    { numRuns: AUTO_MODELS.length * 3 }
  );
  assert.ok(draws >= AUTO_MODELS.length);
});
