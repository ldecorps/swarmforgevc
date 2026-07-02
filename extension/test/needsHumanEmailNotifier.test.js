const assert = require('node:assert/strict');
const test = require('node:test');

const { decideNotifyAction, NeedsHumanEmailNotifier } = require('../out/notify/needsHumanEmailNotifier');

const GRACE_COOLDOWN = { graceSeconds: 60, cooldownSeconds: 600 };
const NOW = Date.parse('2026-07-02T10:00:00Z');

// ── decideNotifyAction (pure) ────────────────────────────────────────────

test('decideNotifyAction skips a role with no needs-human state', () => {
  assert.equal(decideNotifyAction(null, null, NOW, GRACE_COOLDOWN), 'skip');
});

test('decideNotifyAction waits while inside the grace period', () => {
  const since = NOW - 30 * 1000; // 30s ago, grace is 60s
  assert.equal(decideNotifyAction(since, null, NOW, GRACE_COOLDOWN), 'wait');
});

test('decideNotifyAction sends once the grace period has elapsed with no prior email', () => {
  const since = NOW - 61 * 1000;
  assert.equal(decideNotifyAction(since, null, NOW, GRACE_COOLDOWN), 'send');
});

test('decideNotifyAction blocks with cooldown when a recent email was already sent', () => {
  const since = NOW - 61 * 1000;
  const lastSent = NOW - 60 * 1000; // 1 min ago, cooldown is 10 min
  assert.equal(decideNotifyAction(since, lastSent, NOW, GRACE_COOLDOWN), 'cooldown');
});

test('decideNotifyAction sends again once the cooldown window has expired', () => {
  const since = NOW - 61 * 1000;
  const lastSent = NOW - 601 * 1000; // 10m1s ago, cooldown is 10 min
  assert.equal(decideNotifyAction(since, lastSent, NOW, GRACE_COOLDOWN), 'send');
});

// ── NeedsHumanEmailNotifier (adapters injected — no real network) ───────

function mkAdapters(overrides = {}) {
  const sent = [];
  const results = [];
  return {
    sent,
    results,
    adapters: {
      getSessionUrl: () => 'https://claude.ai/code/session_abc',
      getTicketBadge: () => null,
      sendEmail: async (message) => {
        sent.push(message);
        return { success: true };
      },
      onSendResult: (role, result) => results.push({ role, result }),
      ...overrides,
    },
  };
}

function mkConfig(overrides = {}) {
  return {
    enabled: true,
    graceSeconds: 60,
    cooldownSeconds: 600,
    to: 'human@example.com',
    from: 'onboarding@resend.dev',
    ...overrides,
  };
}

// BL-073 email-needs-human-01
test('a persistent question sends exactly one email naming the role and quoting the snippet', async () => {
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Allow this action? (y/n)' }], NOW);
  notifier.sweep(NOW + 61 * 1000);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'SwarmForge: coder needs you');
  assert.match(sent[0].text, /coder is waiting/);
  assert.match(sent[0].text, /Allow this action\? \(y\/n\)/);
  assert.match(sent[0].text, /https:\/\/claude\.ai\/code\/session_abc/);
});

test('a persistent question includes the held ticket badge when one resolves', async () => {
  const { sent, adapters } = mkAdapters({
    getTicketBadge: () => ({ id: 'BL-073', summary: 'email notify on needs-human' }),
  });
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue?' }], NOW);
  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(sent[0].text, /BL-073/);
});

// BL-073 email-needs-human-02
test('a question answered within the grace period sends nothing', () => {
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'QA', needsHuman: true, snippet: 'Approve?' }], NOW);
  notifier.recordUpdates([{ role: 'QA', needsHuman: false }], NOW + 10 * 1000);
  notifier.sweep(NOW + 20 * 1000); // still before the 60s grace period

  assert.equal(sent.length, 0);
});

// BL-073 email-needs-human-03
test('cooldown bounds repeat emails from one role but not an independent role', async () => {
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue?' }], NOW);
  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1, 'first coder email goes out');

  // coder raises further needs-human states inside the cooldown window
  notifier.recordUpdates([{ role: 'coder', needsHuman: false }], NOW + 70 * 1000);
  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue again?' }], NOW + 80 * 1000);
  notifier.sweep(NOW + 200 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1, 'no additional email for coder inside the cooldown window');

  // a persistent needs-human state from the cleaner still emails normally
  notifier.recordUpdates([{ role: 'cleaner', needsHuman: true, snippet: 'Merge?' }], NOW + 100 * 1000);
  notifier.sweep(NOW + 200 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2, 'cleaner still gets its own email');
  assert.equal(sent[1].subject, 'SwarmForge: cleaner needs you');
});

// BL-073 email-needs-human-04
test('no captured session URL still notifies, with a tile-answer fallback line', async () => {
  const { sent, adapters } = mkAdapters({ getSessionUrl: () => null });
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'architect', needsHuman: true, snippet: 'Proceed?' }], NOW);
  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /no session link captured/i);
  assert.match(sent[0].text, /tile/i);
});

// BL-073 email-needs-human-05
test('an unconfigured notifier (disabled) never attempts to send', () => {
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig({ enabled: false }), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue?' }], NOW);
  notifier.sweep(NOW + 61 * 1000);

  assert.equal(sent.length, 0);
});

test('a failing Resend call is reported via onSendResult without throwing, and later attempts still work', async () => {
  const { results, adapters } = mkAdapters({
    sendEmail: async () => ({ success: false, error: 'Resend API responded with status 500' }),
  });
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue?' }], NOW);
  assert.doesNotThrow(() => notifier.sweep(NOW + 61 * 1000));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(results.length, 1);
  assert.equal(results[0].role, 'coder');
  assert.equal(results[0].result.success, false);
  assert.doesNotMatch(results[0].result.error, /re_/);
});

test('a rejected sendEmail promise is caught and reported via onSendResult', async () => {
  const { results, adapters } = mkAdapters({
    sendEmail: async () => {
      throw new Error('network down');
    },
  });
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates([{ role: 'coder', needsHuman: true, snippet: 'Continue?' }], NOW);
  assert.doesNotThrow(() => notifier.sweep(NOW + 61 * 1000));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(results.length, 1);
  assert.equal(results[0].result.success, false);
  assert.match(results[0].result.error, /network down/);
});
