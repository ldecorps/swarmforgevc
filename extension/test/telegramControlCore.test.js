const assert = require('node:assert/strict');
const {
  decideControlEventAction,
  decidePauseAutoResume,
  decideDrainOutcome,
  CONTROL_CALLBACK_DATA,
} = require('../out/tools/telegramControlCore');

const CONTROL_TOPIC_ID = 900;
const PRINCIPAL_ID = 111;
const NOT_PAUSED = { active: false };

function textEvent(text, { fromId = PRINCIPAL_ID, topicId = CONTROL_TOPIC_ID } = {}) {
  return { kind: 'text', text, fromId, topicId };
}

function callbackEvent(data, { fromId = PRINCIPAL_ID, topicId = CONTROL_TOPIC_ID } = {}) {
  return { kind: 'callback', data, fromId, topicId };
}

// ── guard order — topic first, then principal (BL-423 guard #1/#2/#4) ────

test('BL-423: a verb outside the control topic is ignored, even from the principal', () => {
  const decision = decideControlEventAction(textEvent('/stop', { topicId: 5 }), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

test('BL-423: any verb is ignored while no control topic is bound yet', () => {
  const decision = decideControlEventAction(textEvent('/stop'), PRINCIPAL_ID, undefined, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

test('BL-423: an unauthorised sender in the control topic is refused, never ignored', () => {
  const decision = decideControlEventAction(textEvent('/stop', { fromId: 999 }), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'refuse' });
});

test('BL-423 guard #4: an unauthorised tap on a control button is refused, re-applying the same guards', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.emergencyStop, { fromId: 999 }),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'stop-modes' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'refuse' });
});

test('BL-423: a control-topic tap from outside the control topic (a stale/forwarded callback) is ignored', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.emergencyStop, { topicId: 5 }),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'stop-modes' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── /stop ─────────────────────────────────────────────────────────────

test('BL-423: an authorised /stop in the control topic prompts the stop-mode menu', () => {
  const decision = decideControlEventAction(textEvent('/stop'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'prompt-stop-modes' });
});

test('BL-423: /stop is case/whitespace tolerant', () => {
  assert.deepEqual(decideControlEventAction(textEvent('  /STOP  '), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED), { action: 'prompt-stop-modes' });
});

test('BL-423: tapping Emergency stop while a stop-modes confirm is pending executes the emergency stop', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.emergencyStop),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'stop-modes' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'execute-emergency-stop' });
});

test('BL-423: tapping Drain & stop while a stop-modes confirm is pending executes the drain stop', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.drainStop), PRINCIPAL_ID, CONTROL_TOPIC_ID, { kind: 'stop-modes' }, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'execute-drain-stop' });
});

test('BL-423: an emergency-stop tap with NO pending stop-modes confirm (stale/already-actioned) is ignored, never executed', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.emergencyStop), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

test('BL-423: a drain-stop tap while only a restart confirm is pending (wrong pending kind) is ignored', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.drainStop),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'restart-confirm' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── /restart ──────────────────────────────────────────────────────────

test('BL-423: an authorised /restart in the control topic prompts a restart confirm', () => {
  const decision = decideControlEventAction(textEvent('/restart'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'prompt-restart-confirm' });
});

test('BL-423: tapping confirm while a restart confirm is pending executes the restart', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.confirmRestart),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'restart-confirm' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'execute-restart' });
});

test('BL-423: a confirm-restart tap with no pending restart confirm is ignored, never executed', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.confirmRestart), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── cancel (either destructive confirm) ──────────────────────────────────

test('BL-423: cancelling a pending stop-modes confirm leaves the swarm running (cancel, no execute)', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.cancel), PRINCIPAL_ID, CONTROL_TOPIC_ID, { kind: 'stop-modes' }, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'cancel' });
});

test('BL-423: cancelling a pending restart confirm leaves the swarm running', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.cancel),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    { kind: 'restart-confirm' },
    NOT_PAUSED
  );
  assert.deepEqual(decision, { action: 'cancel' });
});

// ── /pause ────────────────────────────────────────────────────────────

test('BL-423: an authorised /pause in the control topic posts the duration menu, freezing nothing yet', () => {
  const decision = decideControlEventAction(textEvent('/pause'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'post-pause-menu' });
});

test('BL-423: picking 15 min applies a timed pause with the 15-minute duration - the pick IS the action, no separate confirm', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.pause15m), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'apply-pause', durationMs: 15 * 60 * 1000 });
});

test('BL-423: picking 1 hr applies a timed pause with the 1-hour duration', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.pause1h), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'apply-pause', durationMs: 60 * 60 * 1000 });
});

test('BL-423: picking 4 hr applies a timed pause with the 4-hour duration', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.pause4h), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'apply-pause', durationMs: 4 * 60 * 60 * 1000 });
});

test('BL-423: picking "Until I resume" applies a pause with no duration (no timer)', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.pauseUntilResume), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'apply-pause', durationMs: undefined });
});

test('BL-423: tapping Resume now while paused restores intake', () => {
  const decision = decideControlEventAction(
    callbackEvent(CONTROL_CALLBACK_DATA.resumeNow),
    PRINCIPAL_ID,
    CONTROL_TOPIC_ID,
    undefined,
    { active: true, untilMs: 12345 }
  );
  assert.deepEqual(decision, { action: 'resume-now' });
});

test('BL-423: a resume-now tap while not actually paused is ignored, never a fabricated resume', () => {
  const decision = decideControlEventAction(callbackEvent(CONTROL_CALLBACK_DATA.resumeNow), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── unrecognized callback data ────────────────────────────────────────

test('BL-423: an unrecognized control callback verb is ignored, never crashes', () => {
  const decision = decideControlEventAction(callbackEvent('control:something-else'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

test('BL-423: callback data outside the control: namespace (e.g. an approve/reject tap) is ignored, never mistaken for a control verb', () => {
  const decision = decideControlEventAction(callbackEvent('approve:BL-123'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── ordinary text (never a recognized verb) ──────────────────────────────

test('BL-423: ordinary chatter in the control topic (not a recognized verb) is ignored', () => {
  const decision = decideControlEventAction(textEvent('hey is everything ok?'), PRINCIPAL_ID, CONTROL_TOPIC_ID, undefined, NOT_PAUSED);
  assert.deepEqual(decision, { action: 'ignore' });
});

// ── decidePauseAutoResume (pure, tick-driven, injected clock) ────────────

test('BL-423: decidePauseAutoResume is none when not paused', () => {
  assert.equal(decidePauseAutoResume(NOT_PAUSED, 1_000_000), 'none');
});

test('BL-423: decidePauseAutoResume is none for "Until I resume" (no timer), regardless of elapsed time', () => {
  assert.equal(decidePauseAutoResume({ active: true, untilMs: undefined }, Number.MAX_SAFE_INTEGER), 'none');
});

test('BL-423: decidePauseAutoResume is none before the timed duration elapses', () => {
  assert.equal(decidePauseAutoResume({ active: true, untilMs: 10_000 }, 9_999), 'none');
});

test('BL-423: decidePauseAutoResume fires exactly at the duration boundary', () => {
  assert.equal(decidePauseAutoResume({ active: true, untilMs: 10_000 }, 10_000), 'auto-resume');
});

test('BL-423: decidePauseAutoResume fires once the timed duration has elapsed', () => {
  assert.equal(decidePauseAutoResume({ active: true, untilMs: 10_000 }, 10_001), 'auto-resume');
});

// ── decideDrainOutcome (pure, mirrors bounceDrain.ts's decideDrainAction) ──

test('BL-423: decideDrainOutcome is "drained" the instant the pipeline is empty, even before the timeout', () => {
  assert.equal(decideDrainOutcome(true, 0, 1, 600_000), 'drained');
});

test('BL-423: decideDrainOutcome is "wait" while work remains and the timeout has not elapsed', () => {
  assert.equal(decideDrainOutcome(false, 0, 599_999, 600_000), 'wait');
});

test('BL-423: decideDrainOutcome is "forced" once the timeout elapses with work still outstanding', () => {
  assert.equal(decideDrainOutcome(false, 0, 600_000, 600_000), 'forced');
});

test('BL-423: decideDrainOutcome prefers "drained" over "forced" even exactly at the timeout boundary', () => {
  assert.equal(decideDrainOutcome(true, 0, 600_000, 600_000), 'drained');
});
