'use strict';

/**
 * BL-1174 declared invariants (coder-authored property tests per BL-654).
 */
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  runDeprecate,
  rankStaleItems,
  seatAllowsDeprecate,
  HARD_TIER_REFUSE_REASON,
  SIZE_ENVELOPE,
} = require('../out/tools/deprecate');

const subjectArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/);

const retireItemArb = fc.record({
  subject: subjectArb,
  kind: fc.constant('orphan-conf-flag'),
  recurrence: fc.integer({ min: 1, max: 8 }),
  blastRadius: fc.integer({ min: 1, max: 8 }),
  adjudication: fc.constant('retire'),
  estimatedFiles: fc.integer({ min: 1, max: SIZE_ENVELOPE.files }),
  estimatedLines: fc.integer({ min: 1, max: SIZE_ENVELOPE.lines }),
});

test('BL-1174 P1: confirm retires at most one subject (one retirement per run)', () => {
  fc.assert(
    fc.property(fc.array(retireItemArb, { minLength: 1, maxLength: 6 }), (raw) => {
      // Unique subjects so conf-line checks stay unambiguous.
      const seen = new Set();
      const signals = [];
      for (const s of raw) {
        if (seen.has(s.subject)) continue;
        seen.add(s.subject);
        signals.push(s);
      }
      if (signals.length === 0) return true;
      const files = new Map([
        [
          'swarmforge/swarmforge.conf',
          signals.map((s) => `config ${s.subject} 1`).join('\n') + '\n',
        ],
        ['docs/index.md', '# Docs\n'],
      ]);
      const result = runDeprecate({
        mode: 'confirm',
        seatTier: 'hard',
        signals,
        writeFile: (p, c) => files.set(p, c),
        readFile: (p) => (files.has(p) ? files.get(p) : null),
      });
      assert.equal(result.outcome, 'retired');
      const top = rankStaleItems(signals)[0].subject;
      assert.equal(result.subject, top);
      const conf = files.get('swarmforge/swarmforge.conf');
      assert.ok(!new RegExp(`^config\\s+${top}\\b`, 'm').test(conf));
      for (const s of signals) {
        if (s.subject === top) continue;
        assert.match(conf, new RegExp(`^config\\s+${s.subject}\\b`, 'm'));
      }
      return true;
    }),
    { numRuns: 40 }
  );
});

test('BL-1174 P2: easy/weak seats always refuse with the hard-tier reason', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('easy', 'weak'),
      fc.constantFrom('dry', 'confirm'),
      fc.array(retireItemArb, { minLength: 0, maxLength: 4 }),
      (tier, mode, signals) => {
        assert.equal(seatAllowsDeprecate(tier), false);
        const writes = [];
        const result = runDeprecate({
          mode,
          seatTier: tier,
          signals,
          writeFile: (p, c) => writes.push({ p, c }),
          readFile: () => null,
        });
        assert.equal(result.outcome, 'refused');
        assert.equal(result.reason, HARD_TIER_REFUSE_REASON);
        assert.equal(writes.length, 0);
        return true;
      }
    ),
    { numRuns: 30 }
  );
});

test('BL-1174 P3: confirm never writes backlog ticket YAML (no auto-close)', () => {
  fc.assert(
    fc.property(retireItemArb, (signal) => {
      const ticketPath = 'backlog/active/BL-42-ticket.yaml';
      const ticketBody = 'id: BL-42\nstatus: todo\n';
      const files = new Map([
        ['swarmforge/swarmforge.conf', `config ${signal.subject} 1\n`],
        ['docs/index.md', '# Docs\n'],
        [ticketPath, ticketBody],
      ]);
      runDeprecate({
        mode: 'confirm',
        seatTier: 'hard',
        signals: [signal],
        writeFile: (p, c) => files.set(p, c),
        readFile: (p) => (files.has(p) ? files.get(p) : null),
      });
      assert.equal(files.get(ticketPath), ticketBody);
      return true;
    }),
    { numRuns: 25 }
  );
});

test('BL-1174 P4: after retire, living index links deprecated stub (withdrawn behaviour parked)', () => {
  fc.assert(
    fc.property(retireItemArb, (signal) => {
      const files = new Map([
        ['swarmforge/swarmforge.conf', `config ${signal.subject} 1\n`],
        ['docs/index.md', '# Docs\n'],
      ]);
      const result = runDeprecate({
        mode: 'confirm',
        seatTier: 'hard',
        signals: [signal],
        writeFile: (p, c) => files.set(p, c),
        readFile: (p) => (files.has(p) ? files.get(p) : null),
      });
      assert.equal(result.outcome, 'retired');
      const index = files.get('docs/index.md');
      assert.match(index, /## Deprecated/);
      assert.ok(files.has(result.stubPath));
      assert.match(files.get(result.stubPath), /Deprecated/);
      assert.ok(!files.get('swarmforge/swarmforge.conf').includes(`config ${signal.subject}`));
      return true;
    }),
    { numRuns: 25 }
  );
});
