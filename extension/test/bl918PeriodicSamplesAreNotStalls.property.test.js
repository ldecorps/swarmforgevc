const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { composeStallEvents, CHASER_ATTENTION_SIGNAL_TYPES } = require('../out/metrics/leanLedgerComposeStall');
const { foldLeanLedgerSnapshot } = require('../out/quality/leanLedger');
const { buildClosingCeremonyPacket } = require('../out/quality/closingCeremony');

// BL-918 (coder.prompt's Invariants section - first authorship rests with
// the coder): two coder-authored property tests, one per declared invariant.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from unit/coverage/mutation.
//
// Non-vacuity, checked by hand before landing: temporarily removing
// leanLedgerComposeStall.ts's `if (!isAttentionSignal(telemetryEvent.type))
// continue;` guard (restoring the exact BL-918 regression - every chaser-
// telemetry row, periodic samples and unrecognised types included, became a
// `stall` regardless of type) made both properties below fail; restoring the
// guard made them pass again.

const WINDOW_START = '2026-08-07T08:00:00.000Z';
const WINDOW_END = '2026-08-07T09:00:00.000Z';
const KNOWN_SAMPLE_TYPES = ['resource_sample', 'host_load_sample'];

function mkTmp() {
  return mkTmpDir('sfvc-bl918-invariant-');
}

function writeHandoff(dir, filename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n\nbody\n');
}

function completedDir(worktree) {
  return path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'completed');
}

function writeChaserTelemetry(mainWorktreePath, monthKey, lines) {
  const dir = path.join(mainWorktreePath, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `chaser-${monthKey}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// Both known-attention, both known-sample, and an arbitrary string standing
// in for "any sample type added later" - the generator's own reach: every
// run mixes real attention signals with types the composer must exclude,
// so a broken allowlist (or a denylist that only knows today's two sample
// types) has a concrete chance to be caught on every single run.
const eventTypeArb = fc.oneof(
  fc.constantFrom(...CHASER_ATTENTION_SIGNAL_TYPES),
  fc.constantFrom(...KNOWN_SAMPLE_TYPES),
  fc.string({ minLength: 1, maxLength: 16 }).filter((s) => !CHASER_ATTENTION_SIGNAL_TYPES.includes(s) && !KNOWN_SAMPLE_TYPES.includes(s))
);

function seedFixture(rows) {
  const main = mkTmp();
  writeHandoff(completedDir(main), '00_a.handoff', {
    task: 'BL-819-x',
    enqueued_at: WINDOW_START,
    dequeued_at: WINDOW_START,
    completed_at: WINDOW_END,
  });
  const telemetry = rows.map((r) => ({
    type: r.type,
    role: 'coder',
    at: new Date(Date.parse(WINDOW_START) + r.offsetMin * 60000).toISOString(),
    count: 1,
  }));
  writeChaserTelemetry(main, '2026-08', telemetry);
  return main;
}

const rowsArb = fc.array(fc.record({ type: eventTypeArb, offsetMin: fc.integer({ min: 1, max: 59 }) }), { minLength: 1, maxLength: 15 });

// Invariant 1: "Only attention signals ... become `stall` events in the
// lean ledger. Periodic measurement telemetry sharing the same file never
// does, whatever sample types exist today or are added later."
test('property: a telemetry row becomes a stall iff its type is a known attention signal, whatever sample type exists today or is invented', () => {
  fc.assert(
    fc.property(rowsArb, (rows) => {
      const main = seedFixture(rows);
      const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: main }];
      const events = composeStallEvents(main, roles, 'BL-819');

      const expectedAttentionCount = rows.filter((r) => CHASER_ATTENTION_SIGNAL_TYPES.includes(r.type)).length;
      assert.equal(events.length, expectedAttentionCount, `expected exactly the attention-signal rows to become stalls, got: ${JSON.stringify(events)}`);
      assert.ok(
        events.every((e) => CHASER_ATTENTION_SIGNAL_TYPES.includes(e.data.eventType)),
        `expected every composed stall to carry a known attention-signal eventType, got: ${JSON.stringify(events)}`
      );
    }),
    { numRuns: 100 }
  );
});

// Invariant 2: "The exclusion happens where the event is classified, so
// every consumer of the ledger's stall events sees the same set without
// re-filtering. A consumer that has to exclude a type itself is the defect,
// not the fix." Proven by running the SAME composed events through two
// independent readers that implement NO type filter of their own
// (foldLeanLedgerSnapshot's foldStall, closingCeremony's computeStalls) and
// showing both land on exactly the attention-signal count - if either
// reader had to re-exclude samples itself, a composer regression would
// still slip a sample through to at least one of them.
test('property: two independent ledger-stall readers, neither filtering by type itself, both see only attention signals', () => {
  fc.assert(
    fc.property(rowsArb, (rows) => {
      const main = seedFixture(rows);
      const roles = [{ role: 'coder', worktreeName: 'coder', worktreePath: main }];
      const events = composeStallEvents(main, roles, 'BL-819');
      const expectedAttentionCount = rows.filter((r) => CHASER_ATTENTION_SIGNAL_TYPES.includes(r.type)).length;

      const snapshot = foldLeanLedgerSnapshot('BL-819', events);
      assert.equal(snapshot.stalls.length, expectedAttentionCount, `expected foldLeanLedgerSnapshot's own stalls to match, got: ${JSON.stringify(snapshot.stalls)}`);

      const packet = buildClosingCeremonyPacket('2026-08-07', events);
      const packetStallCount = packet.stalls.reduce((sum, s) => sum + s.count, 0);
      assert.equal(packetStallCount, expectedAttentionCount, `expected the ceremony packet's own stall summary to match, got: ${JSON.stringify(packet.stalls)}`);
    }),
    { numRuns: 100 }
  );
});
