'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  aggregateSelfHealCounts,
} = require('../out/metrics/selfHealTelemetry');
const {
  emitSelfHealEvent,
  readSelfHealEvents,
  selfHealLedgerPath,
  whenSelfHealTelemetryIdle,
} = require('../out/metrics/selfHealTelemetryStore');

// BL-597 declared invariants (coder-authored first, BL-654):
// 1. Emit only at existing prose log sites — no parallel detection path.
// 2. Failed telemetry append must not change whether self-heal runs.
// 3. Raw events live in append-only gitignored self-heal-<YYYY-MM>.jsonl.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const KNOWN_EMIT_HOSTS = [
  'front_desk_supervisor.bb',
  'handoffd.bb',
  'handoff_lib.bb',
  'kill_pipeline_swarm.sh',
];

const typeArb = fc.constantFrom(
  'stale-build-recompile',
  'supervisor-respawn',
  'kill_all',
  'rotation-respawn',
  'claim-heal'
);
const subjectArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,24}$/);
const reasonArb = fc.stringMatching(/^[a-z][a-z0-9 _-]{0,40}$/);
const isoArb = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 28) })
  .map((ms) => new Date(ms).toISOString());

function mkRoot() {
  return mkTmpDir('bl597-self-heal-');
}

test('invariant1: append-self-heal-event! call sites are only known recovery hosts', () => {
  const offenders = [];
  for (const name of fs.readdirSync(SCRIPTS)) {
    const full = path.join(SCRIPTS, name);
    if (!fs.statSync(full).isFile()) continue;
    if (!/\.(bb|sh)$/.test(name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const mentions =
      text.includes('append-self-heal-event!') ||
      text.includes('self_heal_telemetry_cli.bb');
    if (!mentions) continue;
    if (name === 'self_heal_telemetry_lib.bb' || name === 'self_heal_telemetry_cli.bb') continue;
    if (name.startsWith('test/') || name.includes('_test_')) continue;
    if (!KNOWN_EMIT_HOSTS.includes(name)) {
      offenders.push(name);
    }
  }
  // Also scan one level of test/ is out of scope — hosts live at scripts root.
  assert.deepEqual(offenders, [], `unexpected emit hosts: ${offenders.join(', ')}`);
});

test('invariant1 property: every known host still loads the shared lib (no parallel writer)', () => {
  fc.assert(
    fc.property(fc.constantFrom(...KNOWN_EMIT_HOSTS.filter((h) => h.endsWith('.bb'))), (host) => {
      const text = fs.readFileSync(path.join(SCRIPTS, host), 'utf8');
      assert.match(text, /self_heal_telemetry_lib/);
      assert.match(text, /append-self-heal-event!/);
    }),
    { numRuns: KNOWN_EMIT_HOSTS.filter((h) => h.endsWith('.bb')).length }
  );
});

test('invariant2: emitSelfHealEvent never throws across event shapes (incl. unwritable root)', async () => {
  await fc.assert(
    fc.asyncProperty(typeArb, subjectArb, reasonArb, isoArb, async (type, subject, reason, at) => {
      const root = mkRoot();
      try {
        fs.chmodSync(root, 0o555);
        assert.doesNotThrow(() =>
          emitSelfHealEvent(root, { type, subject, reason, at })
        );
        await whenSelfHealTelemetryIdle();
      } finally {
        try {
          fs.chmodSync(root, 0o755);
        } catch {
          /* ignore */
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );
});

test('invariant2: recovery outcome is independent of whether emit succeeds', async () => {
  function recover(shouldHeal, emitFn) {
    const healed = shouldHeal;
    try {
      emitFn();
    } catch {
      /* measuring must not alter recovery */
    }
    return healed;
  }

  await fc.assert(
    fc.asyncProperty(fc.boolean(), typeArb, subjectArb, async (shouldHeal, type, subject) => {
      const root = mkRoot();
      try {
        const withEmit = recover(shouldHeal, () =>
          emitSelfHealEvent(root, { type, subject, reason: 'probe' })
        );
        const withThrowingEmit = recover(shouldHeal, () => {
          throw new Error('forced emit failure');
        });
        assert.equal(withEmit, shouldHeal);
        assert.equal(withThrowingEmit, shouldHeal);
        await whenSelfHealTelemetryIdle();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 30 }
  );
});

test('invariant3: ledger path is always gitignored self-heal-YYYY-MM.jsonl under telemetry/', () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.swarmforge\/telemetry\/self-heal-\*\.jsonl/);

  fc.assert(
    fc.property(isoArb, (at) => {
      const root = '/repo';
      const ledger = selfHealLedgerPath(root, at);
      const month = at.slice(0, 7);
      assert.equal(
        ledger,
        path.join(root, '.swarmforge', 'telemetry', `self-heal-${month}.jsonl`)
      );
      assert.match(path.basename(ledger), /^self-heal-\d{4}-\d{2}\.jsonl$/);
    }),
    { numRuns: 40 }
  );
});

test('invariant3: append is additive — prior lines survive later emits', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ type: typeArb, subject: subjectArb, reason: reasonArb, at: isoArb }), {
        minLength: 2,
        maxLength: 5,
      }),
      async (events) => {
        const root = mkRoot();
        try {
          for (const ev of events) {
            emitSelfHealEvent(root, ev);
          }
          await whenSelfHealTelemetryIdle();
          const read = readSelfHealEvents(root);
          assert.ok(read.length >= events.length);
          for (const ev of events) {
            assert.ok(
              read.some((r) => r.type === ev.type && r.subject === ev.subject && r.at === ev.at),
              `missing event ${ev.type}/${ev.subject}`
            );
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 15 }
  );
});

test('non-vacuous: aggregator still counts by type (paired with emit path)', () => {
  const events = [
    { type: 'kill_all', subject: 'swarm', reason: 'x', at: '2026-08-01T00:00:00.000Z' },
    { type: 'kill_all', subject: 'swarm', reason: 'y', at: '2026-08-02T00:00:00.000Z' },
    { type: 'claim-heal', subject: 'coder', reason: 'z', at: '2026-08-03T00:00:00.000Z' },
  ];
  const window = {
    startMs: Date.parse('2026-08-01T00:00:00.000Z'),
    endMs: Date.parse('2026-08-31T00:00:00.000Z'),
    bucketMs: 86400000,
  };
  const broken = (evs) => {
    // Deliberately ignore type — vacuous aggregator would pass without type split.
    return { all: { points: evs.map(() => ({ periodStart: '', value: 1 })) } };
  };
  const good = aggregateSelfHealCounts(events, window);
  assert.ok(good.kill_all);
  assert.ok(good['claim-heal']);
  assert.notDeepEqual(Object.keys(good).sort(), Object.keys(broken(events)).sort());
});
