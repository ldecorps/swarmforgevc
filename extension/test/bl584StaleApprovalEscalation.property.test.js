'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { APPROVAL_ASK_LOCATOR } = require('../out/concierge/topicRouter');
const {
  DEFAULT_STALE_AFTER_MS,
  selectStaleApprovalAsks,
} = require('../out/notify/staleApprovalEscalation');

// BL-584 declared invariant:
// An ask's staleness clock resets only on human activity or a re-minted ask —
// never on swarm outbound posts or file mtime; missing evidence fails closed
// to not-stale.
//
// Runs ONLY via `npm run test:properties`.

const NOW = Date.parse('2026-08-24T12:00:00Z');
const HOUR = 3_600_000;

function ask(ts) {
  return {
    seq: 1,
    ts,
    author: 'swarm',
    type: 'outbound',
    text: `BL-100 ${APPROVAL_ASK_LOCATOR} before it can proceed.`,
  };
}

function msg(type, ts, seq) {
  return {
    seq,
    ts,
    author: type === 'inbound' ? 'human' : 'swarm',
    type,
    text: type === 'inbound' ? 'reply' : 'swarm noise (no locator)',
  };
}

test('property: only inbound / re-minted ask reset the clock; missing evidence is not-stale', () => {
  let casesWithInboundReset = 0;
  let casesWithOutboundNoise = 0;
  let casesMissingEvidence = 0;
  const numRuns = 40;
  fc.assert(
    fc.property(
      fc.integer({ min: 3, max: 12 }),
      fc.integer({ min: 1, max: 50 }),
      fc.constantFrom('inbound', 'outbound', 'none', 'missing-record', 'missing-ask'),
      fc.integer({ min: 1, max: 6 }),
      (askAgeHours, recentMinutes, afterAsk, remintHours) => {
        const askTs = NOW - askAgeHours * HOUR;
        const recentTs = NOW - recentMinutes * 60 * 1000;
        if (afterAsk === 'missing-record') {
          casesMissingEvidence += 1;
          const selected = selectStaleApprovalAsks(
            [{ id: 'BL-100', state: 'pending', topicRecord: undefined, askMessageId: 1, askTopicId: 1785 }],
            NOW,
            DEFAULT_STALE_AFTER_MS
          );
          assert.equal(selected.length, 0);
          return;
        }
        if (afterAsk === 'missing-ask') {
          casesMissingEvidence += 1;
          const selected = selectStaleApprovalAsks(
            [
              {
                id: 'BL-100',
                state: 'pending',
                topicRecord: { id: 'BL-100', messages: [msg('outbound', askTs, 1)] },
                askMessageId: 1,
                askTopicId: 1785,
              },
            ],
            NOW,
            DEFAULT_STALE_AFTER_MS
          );
          assert.equal(selected.length, 0);
          return;
        }

        const messages = [ask(askTs)];
        if (afterAsk === 'inbound') {
          casesWithInboundReset += 1;
          messages.push(msg('inbound', recentTs, 2));
        } else if (afterAsk === 'outbound') {
          casesWithOutboundNoise += 1;
          messages.push(msg('outbound', recentTs, 2));
        } else if (remintHours < askAgeHours) {
          // Re-minted ask after the original — newest locator wins.
          messages.push(ask(NOW - remintHours * HOUR));
          messages[1].seq = 2;
        }

        const selected = selectStaleApprovalAsks(
          [
            {
              id: 'BL-100',
              state: 'pending',
              topicRecord: { id: 'BL-100', messages },
              askMessageId: 1,
              askTopicId: 1785,
            },
          ],
          NOW,
          DEFAULT_STALE_AFTER_MS
        );

        const clockSource =
          afterAsk === 'inbound'
            ? Math.max(askTs, recentTs)
            : afterAsk === 'none' && remintHours < askAgeHours
              ? NOW - remintHours * HOUR
              : askTs;
        const expectStale = NOW - clockSource >= DEFAULT_STALE_AFTER_MS;
        assert.equal(selected.length === 1, expectStale);
      }
    ),
    { numRuns }
  );
  assert.ok(casesWithInboundReset > 0, 'generator must reach inbound reset');
  assert.ok(casesWithOutboundNoise > 0, 'generator must reach outbound noise');
  assert.ok(casesMissingEvidence > 0, 'generator must reach missing-evidence arms');
});
