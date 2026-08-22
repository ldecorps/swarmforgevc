const assert = require('node:assert/strict');

// BL-621: two defects, one theme - sustained degradation is silent.
//
// 1. The poll degraded warning DISCARDED its cause. getUpdates already
//    returns a fully formatted transport error (formatApiFailureError), but
//    pollAndForward threw it away, so 9 hours of the 2026-07-24 rival-poller
//    incident read "poll degraded - 5 consecutive failures, still retrying"
//    with no mention of the 409 Conflict that named the rival in one line.
//    The reply-relay twin already interpolated its own error; the poll path
//    was the asymmetric one.
//
// 2. NOTHING escalated a sustained outage. The poll heartbeat deliberately
//    stamps on failed cycles (BL-370), so a permanently failing loop reads
//    healthy to the supervisor; the relay retried forever at a 60s cap with
//    one stderr line per streak. A sustained-degraded EPISODE now escalates
//    once - via the same direct-send channel stuck-delivery uses, which
//    still works while getUpdates itself is 409-ing, because sending does
//    not poll.
//
// Every decision here is a pure function of (episode state, ok, nowMs,
// threshold): the clock is a fixture number, never the wall clock.
const {
  pollAndForward,
  decideSustainedOutage,
  formatSustainedOutageEscalation,
  sustainedOutageThresholdMs,
  describeOutageCause,
  DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS,
  STUCK_DELIVERY_ESCALATION_TEXT,
  runPollCycle,
  applyPollCycleResult,
  computeReplyRelayCycleResult,
  applyReplyRelayCycleResult,
} = require('../out/tools/telegramFrontDeskBotCore');

const PRINCIPAL_ID = '4242';
const MINUTE = 60_000;
const THRESHOLD_MS = 30 * MINUTE;

// The real text getTelegramUpdates hands back for the incident's own
// failure - the one line that would have named the rival poller.
const CONFLICT_ERROR = 'Telegram API responded with status 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running';

const CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  stuckRetryLimit: 3,
  sustainedOutageThresholdMs: THRESHOLD_MS,
};

const HEALTHY = { escalated: false };

function failingAdapters(error) {
  return { chatId: '1', getUpdates: async () => ({ success: false, updates: [], error }) };
}

function okAdapters() {
  return { chatId: '1', getUpdates: async () => ({ success: true, updates: [] }) };
}

function freshPollState() {
  return { offset: 0, consecutiveFailures: 0, stuckAttempts: 0, sustainedOutage: HEALTHY };
}

// ── fix 1: the failed cycle carries its own cause ────────────────────────

test('BL-621 degraded-warning-names-cause-01: a failed poll cycle carries the transport error instead of discarding it', async () => {
  const result = await pollAndForward(7, PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR));
  assert.equal(result.ok, false);
  assert.equal(result.nextOffset, 7, 'a failed cycle must never move the offset');
  assert.equal(result.error, CONFLICT_ERROR);
});

test('BL-621: a successful poll cycle carries no error at all', async () => {
  const result = await pollAndForward(7, PRINCIPAL_ID, okAdapters());
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
});

test('BL-621 degraded-warning-names-cause-01: runPollCycle surfaces the failed cycle error to the warning layer', async () => {
  const cycle = await runPollCycle(freshPollState(), PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR), CONFIG, 0);
  assert.equal(cycle.errorMessage, CONFLICT_ERROR);
});

test('BL-621: a successful cycle surfaces no error message', async () => {
  const cycle = await runPollCycle(freshPollState(), PRINCIPAL_ID, okAdapters(), CONFIG, 0);
  assert.equal(cycle.errorMessage, undefined);
});

test('BL-621 degraded-warning-names-cause-01: the degraded warning line names the 409 Conflict text', async () => {
  const warnings = [];
  const cycle = {
    state: { offset: 0, consecutiveFailures: 3, stuckAttempts: 0, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: true,
    escalateStuckDelivery: false,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
    errorMessage: CONFLICT_ERROR,
  };
  await applyPollCycleResult(cycle, (message) => warnings.push(message), async () => {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /poll degraded - 3 consecutive failures, still retrying: /);
  assert.match(warnings[0], /409: Conflict: terminated by other getUpdates request/);
});

test('BL-621 warning-cadence-unchanged-02: the degraded warning still fires exactly once per failure streak', async () => {
  const warnings = [];
  let state = freshPollState();
  for (let i = 1; i <= 8; i++) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR), CONFIG, i * MINUTE);
    state = cycle.state;
    await applyPollCycleResult(cycle, (message) => warnings.push(message), async () => {});
  }
  assert.equal(warnings.length, 1, `expected one warning for the streak, got:\n${warnings.join('')}`);
});

// ── fix 2 core: the sustained-outage episode decision (pure) ─────────────

test('BL-621: a healthy cycle opens no episode and never escalates', () => {
  const decision = decideSustainedOutage(HEALTHY, true, 5 * MINUTE, THRESHOLD_MS);
  assert.deepEqual(decision, { state: { escalated: false }, escalate: false, outageMs: 0 });
});

test('BL-621: the first failure opens an episode stamped with the current clock, without escalating', () => {
  const decision = decideSustainedOutage(HEALTHY, false, 5 * MINUTE, THRESHOLD_MS);
  assert.equal(decision.escalate, false);
  assert.equal(decision.outageMs, 0);
  assert.deepEqual(decision.state, { failingSinceMs: 5 * MINUTE, escalated: false });
});

test('BL-621: a continuing episode keeps its ORIGINAL start, so the outage duration grows', () => {
  const open = { failingSinceMs: 5 * MINUTE, escalated: false };
  const decision = decideSustainedOutage(open, false, 12 * MINUTE, THRESHOLD_MS);
  assert.equal(decision.state.failingSinceMs, 5 * MINUTE);
  assert.equal(decision.outageMs, 7 * MINUTE);
  assert.equal(decision.escalate, false, 'still short of the threshold');
});

test('BL-621 sustained-poll-outage-escalates-once-03: crossing the threshold escalates exactly once', () => {
  const open = { failingSinceMs: 0, escalated: false };
  const crossing = decideSustainedOutage(open, false, THRESHOLD_MS, THRESHOLD_MS);
  assert.equal(crossing.escalate, true, 'the threshold boundary itself counts as crossed');
  assert.equal(crossing.state.escalated, true);
  const later = decideSustainedOutage(crossing.state, false, THRESHOLD_MS + 10 * MINUTE, THRESHOLD_MS);
  assert.equal(later.escalate, false, 'the same episode must never escalate twice');
  assert.equal(later.outageMs, THRESHOLD_MS + 10 * MINUTE);
});

test('BL-621: one millisecond short of the threshold does not escalate', () => {
  const decision = decideSustainedOutage({ failingSinceMs: 0, escalated: false }, false, THRESHOLD_MS - 1, THRESHOLD_MS);
  assert.equal(decision.escalate, false);
});

test('BL-621 recovery-closes-episode-04: recovery closes the episode and a later outage escalates again', () => {
  const escalated = { failingSinceMs: 0, escalated: true };
  const recovered = decideSustainedOutage(escalated, true, THRESHOLD_MS + MINUTE, THRESHOLD_MS);
  assert.deepEqual(recovered.state, { escalated: false }, 'recovery must clear both the start stamp and the latch');
  const reopened = decideSustainedOutage(recovered.state, false, THRESHOLD_MS + 2 * MINUTE, THRESHOLD_MS);
  assert.equal(reopened.escalate, false);
  const crossedAgain = decideSustainedOutage(reopened.state, false, 2 * THRESHOLD_MS + 2 * MINUTE, THRESHOLD_MS);
  assert.equal(crossedAgain.escalate, true, 'a NEW episode gets its own escalation');
});

// ── fix 2 core: the escalation text ──────────────────────────────────────

test('BL-621: the escalation names the loop, the outage duration and the last error', () => {
  const text = formatSustainedOutageEscalation('poll', 31 * MINUTE, CONFLICT_ERROR);
  assert.match(text, /poll/);
  assert.match(text, /31m/);
  assert.match(text, /409: Conflict/);
});

test('BL-621: the relay escalation names the relay loop and its own duration', () => {
  const text = formatSustainedOutageEscalation('reply-relay', 90 * MINUTE, 'connection reset');
  assert.match(text, /reply-relay/);
  assert.match(text, /1h 30m/);
  assert.match(text, /connection reset/);
});

test('BL-621: an outage with no recorded error still escalates, saying so', () => {
  const text = formatSustainedOutageEscalation('poll', 45 * MINUTE, undefined);
  assert.match(text, /cause unknown/);
  assert.match(text, /45m/);
});

test('BL-621: a cycle that recorded no error prints a cause anyway - never the word "undefined"', async () => {
  const warnings = [];
  const cycle = {
    state: { offset: 0, consecutiveFailures: 3, stuckAttempts: 0, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: true,
    escalateStuckDelivery: false,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
  };
  await applyPollCycleResult(cycle, (message) => warnings.push(message), async () => {});
  assert.match(warnings[0], /still retrying: cause unknown/);
  assert.equal(describeOutageCause(undefined), 'cause unknown');
  assert.equal(describeOutageCause('boom'), 'boom');
});

test('BL-621: the relay warning gets the same treatment - both halves name a cause', async () => {
  const warnings = [];
  const cycle = {
    state: { consecutiveFailures: 3, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: true,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
  };
  await applyReplyRelayCycleResult(cycle, undefined, (message) => warnings.push(message), async () => {});
  assert.match(warnings[0], /still retrying: cause unknown/);
});

// ── fix 2 core: the configurable threshold ───────────────────────────────

test('BL-621: an unset conf key falls back to the 30-minute default', () => {
  assert.equal(DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS, 30 * MINUTE);
  assert.equal(sustainedOutageThresholdMs(undefined), 30 * MINUTE);
});

test('BL-621: a configured value is read in minutes, fractions included (so a live test can use a short window)', () => {
  assert.equal(sustainedOutageThresholdMs('5'), 5 * MINUTE);
  assert.equal(sustainedOutageThresholdMs('0.5'), 30_000);
});

test('BL-621: an unparseable or non-positive conf value falls back to the default rather than escalating instantly', () => {
  assert.equal(sustainedOutageThresholdMs('soon'), 30 * MINUTE);
  assert.equal(sustainedOutageThresholdMs('0'), 30 * MINUTE);
  assert.equal(sustainedOutageThresholdMs('-3'), 30 * MINUTE);
  assert.equal(sustainedOutageThresholdMs(''), 30 * MINUTE);
});

// ── fix 2 wiring: the poll loop ──────────────────────────────────────────

test('BL-621 sustained-poll-outage-escalates-once-03: a poll outage past the threshold escalates once, then never again in the same episode', async () => {
  const escalations = [];
  let state = freshPollState();
  for (let minute = 0; minute <= 90; minute += 10) {
    const cycle = await runPollCycle(state, PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR), CONFIG, minute * MINUTE);
    state = cycle.state;
    await applyPollCycleResult(cycle, () => {}, async () => {}, async (message) => escalations.push(message));
  }
  assert.equal(escalations.length, 1, `expected exactly one escalation, got ${escalations.length}`);
  assert.match(escalations[0], /poll/);
  assert.match(escalations[0], /30m/);
  assert.match(escalations[0], /409: Conflict/);
});

test('BL-621: the escalation is sent while getUpdates itself is failing - the direct channel does not poll', async () => {
  const sent = [];
  const state = { offset: 0, consecutiveFailures: 40, stuckAttempts: 0, sustainedOutage: { failingSinceMs: 0, escalated: false } };
  const cycle = await runPollCycle(state, PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR), CONFIG, THRESHOLD_MS);
  assert.equal(cycle.escalateSustainedOutage, true);
  assert.equal(cycle.sustainedOutageMs, THRESHOLD_MS);
  await applyPollCycleResult(cycle, () => {}, async () => {}, async (message) => sent.push(message));
  assert.equal(sent.length, 1);
});

test('BL-621 recovery-closes-episode-04: a recovered poll cycle closes the episode and re-arms escalation', async () => {
  const escalated = { offset: 0, consecutiveFailures: 40, stuckAttempts: 0, sustainedOutage: { failingSinceMs: 0, escalated: true } };
  const recovered = await runPollCycle(escalated, PRINCIPAL_ID, okAdapters(), CONFIG, THRESHOLD_MS);
  assert.deepEqual(recovered.state.sustainedOutage, { escalated: false });
  assert.equal(recovered.escalateSustainedOutage, false);
  const reopened = await runPollCycle(recovered.state, PRINCIPAL_ID, failingAdapters('network down'), CONFIG, THRESHOLD_MS + MINUTE);
  const crossed = await runPollCycle(reopened.state, PRINCIPAL_ID, failingAdapters('network down'), CONFIG, 2 * THRESHOLD_MS + MINUTE);
  assert.equal(crossed.escalateSustainedOutage, true, 'a new episode escalates on its own merits');
});

test('BL-621 heartbeat-semantics-unchanged-06: a failed, escalating cycle still stamps the poll heartbeat (BL-370 guard)', async () => {
  const beats = [];
  const state = { offset: 0, consecutiveFailures: 40, stuckAttempts: 0, sustainedOutage: { failingSinceMs: 0, escalated: false } };
  const cycle = await runPollCycle(state, PRINCIPAL_ID, failingAdapters(CONFLICT_ERROR), CONFIG, THRESHOLD_MS);
  await applyPollCycleResult(cycle, () => {}, async () => {}, async () => {}, () => beats.push('stamped'));
  assert.deepEqual(beats, ['stamped']);
});

test('BL-621 escalation-failure-tolerated-07: an escalation send that throws is logged and never faults the loop', async () => {
  const warnings = [];
  const waits = [];
  const cycle = {
    state: { offset: 0, consecutiveFailures: 40, stuckAttempts: 0, sustainedOutage: { failingSinceMs: 0, escalated: true } },
    delayMs: 8000,
    degradedWarning: false,
    escalateStuckDelivery: false,
    escalateSustainedOutage: true,
    sustainedOutageMs: THRESHOLD_MS,
    errorMessage: CONFLICT_ERROR,
  };
  await assert.doesNotReject(() =>
    applyPollCycleResult(
      cycle,
      (message) => warnings.push(message),
      async (ms) => waits.push(ms),
      async () => {
        throw new Error('sendMessage exploded');
      }
    )
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /escalation send failed: sendMessage exploded/);
  assert.deepEqual(waits, [8000], 'the loop must still take its backoff after a failed escalation');
});

test('BL-621: the stuck-delivery escalation still fires, now carrying its own text', async () => {
  const sent = [];
  const cycle = {
    state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 3, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: false,
    escalateStuckDelivery: true,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
  };
  await applyPollCycleResult(cycle, () => {}, async () => {}, async (message) => sent.push(message));
  assert.deepEqual(sent, [STUCK_DELIVERY_ESCALATION_TEXT]);
  assert.match(STUCK_DELIVERY_ESCALATION_TEXT, /could not be delivered/);
});

test('BL-621: a stuck-delivery escalation that throws is tolerated the same way', async () => {
  const warnings = [];
  const cycle = {
    state: { offset: 0, consecutiveFailures: 0, stuckAttempts: 3, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: false,
    escalateStuckDelivery: true,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
  };
  await assert.doesNotReject(() =>
    applyPollCycleResult(cycle, (message) => warnings.push(message), async () => {}, async () => {
      throw new Error('nope');
    })
  );
  assert.match(warnings[0], /escalation send failed: nope/);
});

test('BL-621: applyPollCycleResult still defaults both escalate and recordHeartbeat to no-ops', async () => {
  const cycle = {
    state: { offset: 0, consecutiveFailures: 40, stuckAttempts: 3, sustainedOutage: HEALTHY },
    delayMs: 0,
    degradedWarning: false,
    escalateStuckDelivery: true,
    escalateSustainedOutage: true,
    sustainedOutageMs: THRESHOLD_MS,
  };
  await assert.doesNotReject(() => applyPollCycleResult(cycle, () => {}, async () => {}));
});

// ── fix 2 wiring: the reply-relay loop ───────────────────────────────────

function freshRelayState() {
  return { consecutiveFailures: 0, sustainedOutage: HEALTHY };
}

test('BL-621 relay-sustained-reconnect-escalates-05: a sustained relay outage escalates once and keeps retrying', async () => {
  const escalations = [];
  const waits = [];
  let state = freshRelayState();
  for (let minute = 0; minute <= 90; minute += 10) {
    const cycle = computeReplyRelayCycleResult(state, false, CONFIG, minute * MINUTE);
    state = cycle.state;
    await applyReplyRelayCycleResult(cycle, 'connection reset', () => {}, async (ms) => waits.push(ms), async (message) =>
      escalations.push(message)
    );
  }
  assert.equal(escalations.length, 1);
  assert.match(escalations[0], /reply-relay/);
  assert.match(escalations[0], /30m/);
  assert.match(escalations[0], /connection reset/);
  assert.equal(waits.length, 10, 'retry-forever with capped backoff is unchanged - every cycle still waits');
  assert.equal(waits[waits.length - 1], CONFIG.backoffMaxMs, 'the backoff still caps rather than growing forever');
});

test('BL-621: a relay reconnect that succeeds closes the episode', () => {
  const escalated = { consecutiveFailures: 40, sustainedOutage: { failingSinceMs: 0, escalated: true } };
  const cycle = computeReplyRelayCycleResult(escalated, true, CONFIG, THRESHOLD_MS);
  assert.deepEqual(cycle.state, { consecutiveFailures: 0, sustainedOutage: { escalated: false } });
  assert.equal(cycle.escalateSustainedOutage, false);
  assert.equal(cycle.sustainedOutageMs, 0);
});

test('BL-621 escalation-failure-tolerated-07: a failed relay escalation send is logged, and the relay still backs off', async () => {
  const warnings = [];
  const waits = [];
  const cycle = {
    state: { consecutiveFailures: 40, sustainedOutage: { failingSinceMs: 0, escalated: true } },
    delayMs: 8000,
    degradedWarning: false,
    escalateSustainedOutage: true,
    sustainedOutageMs: THRESHOLD_MS,
  };
  await assert.doesNotReject(() =>
    applyReplyRelayCycleResult(
      cycle,
      'connection reset',
      (message) => warnings.push(message),
      async (ms) => waits.push(ms),
      async () => {
        throw new Error('send died');
      }
    )
  );
  assert.match(warnings[0], /escalation send failed: send died/);
  assert.deepEqual(waits, [8000]);
});

test('BL-621: applyReplyRelayCycleResult still defaults its escalate adapter to a no-op', async () => {
  const cycle = {
    state: { consecutiveFailures: 40, sustainedOutage: { failingSinceMs: 0, escalated: true } },
    delayMs: 0,
    degradedWarning: false,
    escalateSustainedOutage: true,
    sustainedOutageMs: THRESHOLD_MS,
  };
  await assert.doesNotReject(() => applyReplyRelayCycleResult(cycle, 'x', () => {}, async () => {}));
});

test('BL-621: the relay degraded warning is unchanged - it already named its error', async () => {
  const warnings = [];
  const cycle = {
    state: { consecutiveFailures: 3, sustainedOutage: { failingSinceMs: 0, escalated: false } },
    delayMs: 0,
    degradedWarning: true,
    escalateSustainedOutage: false,
    sustainedOutageMs: 0,
  };
  await applyReplyRelayCycleResult(cycle, 'connection reset', (message) => warnings.push(message), async () => {});
  assert.match(warnings[0], /reply-relay degraded - 3 consecutive reconnect failures, still retrying: connection reset/);
});
