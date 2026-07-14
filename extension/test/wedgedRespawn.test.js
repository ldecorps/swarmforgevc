const assert = require('node:assert/strict');

const {
  decideWedgedRespawnAction,
  handleWedgedRespawnTrigger,
  resetWedgedRespawnState,
} = require('../out/watchdog/wedgedRespawn');

const CONFIG = { maxRecoveryAttempts: 3, respawnCooldownSeconds: 300 };

function fakeAdapters(overrides = {}) {
  const calls = { respawn: [], escalation: [] };
  const adapters = {
    respawnAgent: (role) => {
      calls.respawn.push(role);
      return { success: true, message: 'ok' };
    },
    setStuckEscalation: (role, escalated) => {
      calls.escalation.push([role, escalated]);
    },
    ...overrides,
  };
  return { adapters, calls };
}

test('decideWedgedRespawnAction: respawns when under the bound and outside cooldown', () => {
  assert.equal(decideWedgedRespawnAction(0, null, 1000, CONFIG), 'respawn');
  assert.equal(decideWedgedRespawnAction(2, null, 1000, CONFIG), 'respawn');
});

test('decideWedgedRespawnAction: escalates once attempts reach maxRecoveryAttempts', () => {
  assert.equal(decideWedgedRespawnAction(3, null, 1000, CONFIG), 'escalate');
  assert.equal(decideWedgedRespawnAction(5, null, 1000, CONFIG), 'escalate');
});

test('decideWedgedRespawnAction: skips for cooldown before it elapses, respawns after', () => {
  const lastRespawnAtMs = 10_000;
  const withinCooldown = lastRespawnAtMs + CONFIG.respawnCooldownSeconds * 1000 - 1;
  const afterCooldown = lastRespawnAtMs + CONFIG.respawnCooldownSeconds * 1000 + 1;
  assert.equal(decideWedgedRespawnAction(0, lastRespawnAtMs, withinCooldown, CONFIG), 'skip-cooldown');
  assert.equal(decideWedgedRespawnAction(0, lastRespawnAtMs, afterCooldown, CONFIG), 'respawn');
});

// BL-147 wedged-respawn-01: a genuinely wedged (idle) pane is respawned.
test('handleWedgedRespawnTrigger respawns a wedged pane via the verified-respawn path', () => {
  resetWedgedRespawnState('coder');
  const { adapters, calls } = fakeAdapters();
  const action = handleWedgedRespawnTrigger('coder', 1000, CONFIG, adapters);
  assert.equal(action, 'respawned');
  assert.deepEqual(calls.respawn, ['coder']);
  assert.deepEqual(calls.escalation, []);
});

// BL-147 wedged-respawn-02: a busy mid-turn pane is never respawned/injected
// into, and the skip is distinguishable from a real attempt.
test('handleWedgedRespawnTrigger records a skip and never escalates or consumes the bound for a busy pane', () => {
  resetWedgedRespawnState('coder');
  const { adapters, calls } = fakeAdapters({
    respawnAgent: (role) => {
      calls.respawn.push(role);
      return { success: false, skippedBusy: true, message: 'actively processing' };
    },
  });
  const action = handleWedgedRespawnTrigger('coder', 1000, CONFIG, adapters);
  assert.equal(action, 'skipped-busy');
  assert.deepEqual(calls.escalation, []);

  // A busy skip must not have consumed an attempt: calling again immediately
  // (same instant, so cooldown cannot be the reason) still respawns rather
  // than escalating or waiting out a cooldown that was never started.
  const again = handleWedgedRespawnTrigger('coder', 1000, CONFIG, {
    ...adapters,
    respawnAgent: () => ({ success: true, message: 'ok' }),
  });
  assert.equal(again, 'respawned');
});

// BL-147 wedged-respawn-03: automatic respawns are bounded and fall back to
// needs-human once maxRecoveryAttempts is reached.
test('handleWedgedRespawnTrigger stops attempting after maxRecoveryAttempts and escalates', () => {
  resetWedgedRespawnState('coder');
  let now = 0;
  const { adapters, calls } = fakeAdapters();

  for (let i = 0; i < CONFIG.maxRecoveryAttempts; i++) {
    const action = handleWedgedRespawnTrigger('coder', now, CONFIG, adapters);
    assert.equal(action, 'respawned');
    now += CONFIG.respawnCooldownSeconds * 1000 + 1; // clear cooldown each time
  }

  const finalAction = handleWedgedRespawnTrigger('coder', now, CONFIG, adapters);
  assert.equal(finalAction, 'escalated');
  assert.equal(calls.respawn.length, CONFIG.maxRecoveryAttempts);
  assert.deepEqual(calls.escalation, [['coder', true]]);
});

// BL-147 wedged-respawn-04: respawns respect the cooldown between attempts.
test('handleWedgedRespawnTrigger skips a second respawn attempt within the cooldown window', () => {
  resetWedgedRespawnState('coder');
  const { adapters, calls } = fakeAdapters();

  const first = handleWedgedRespawnTrigger('coder', 1000, CONFIG, adapters);
  assert.equal(first, 'respawned');

  const stillCoolingDown = 1000 + CONFIG.respawnCooldownSeconds * 1000 - 1;
  const second = handleWedgedRespawnTrigger('coder', stillCoolingDown, CONFIG, adapters);
  assert.equal(second, 'skipped-cooldown');
  assert.equal(calls.respawn.length, 1);

  const afterCooldown = 1000 + CONFIG.respawnCooldownSeconds * 1000 + 1;
  const third = handleWedgedRespawnTrigger('coder', afterCooldown, CONFIG, adapters);
  assert.equal(third, 'respawned');
  assert.equal(calls.respawn.length, 2);
});

test('resetWedgedRespawnState(role) clears only that role; no-arg clears all', () => {
  resetWedgedRespawnState();
  const { adapters } = fakeAdapters();
  handleWedgedRespawnTrigger('coder', 1000, CONFIG, adapters);
  handleWedgedRespawnTrigger('qa', 1000, CONFIG, adapters);

  resetWedgedRespawnState('coder');
  // coder's state cleared -> respawns again immediately despite the cooldown
  const coderAgain = handleWedgedRespawnTrigger('coder', 1001, CONFIG, adapters);
  assert.equal(coderAgain, 'respawned');
  // qa's state untouched -> still cooling down
  const qaAgain = handleWedgedRespawnTrigger('qa', 1001, CONFIG, adapters);
  assert.equal(qaAgain, 'skipped-cooldown');
});
