const assert = require('node:assert/strict');
const test = require('node:test');

const { NeedsHumanReconciler } = require('../out/panel/needsHumanReconciler');
const { NeedsHumanEmailNotifier } = require('../out/notify/needsHumanEmailNotifier');

// BL-073's email notifier must be fed the RECONCILED needs-human signal (the
// same one that drives the tile's red border, per swarmPanel.ts), not either
// raw source (question detector, stuck-in-process chaser) directly. Feeding
// a raw source would reopen the exact race needsHumanReconciler.ts exists to
// close (BL-067) -- just as a missed/premature email instead of a missed/
// premature red border.

const GRACE_COOLDOWN = { graceSeconds: 60, cooldownSeconds: 600 };
const NOW = Date.parse('2026-07-02T10:00:00Z');

function mkAdapters() {
  const sent = [];
  return {
    sent,
    adapters: {
      getSessionUrl: () => null,
      getTicketBadge: () => null,
      sendEmail: async (message) => {
        sent.push(message);
        return { success: true };
      },
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

test('a stuck-escalated role (no question ever detected) still starts the email grace clock', async () => {
  const reconciler = new NeedsHumanReconciler();
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  // The question detector never fires for this role -- only the BL-067
  // stuck-in-process chaser escalates it (the silent-overnight-stall case).
  const deltas = reconciler.applyStuckRoles(['hardender']);
  notifier.recordUpdates(deltas, NOW);
  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1, 'a stuck-only escalation must still email — this is BL-067/073\'s core motivating scenario');
  assert.match(sent[0].text, /hardender is waiting/);
});

test('the question detector clearing does not cancel a pending email while the chaser still holds the role escalated', async () => {
  const reconciler = new NeedsHumanReconciler();
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  // Role is flagged by both sources...
  notifier.recordUpdates(reconciler.applyQuestionEvents([{ role: 'hardender', needsHuman: true }]), NOW);
  notifier.recordUpdates(reconciler.applyStuckRoles(['hardender']), NOW);
  // ...then the question detector alone reports false (e.g. the pane stopped
  // matching a question pattern), but the chaser has not recovered.
  notifier.recordUpdates(reconciler.applyQuestionEvents([{ role: 'hardender', needsHuman: false }]), NOW + 5000);

  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    sent.length,
    1,
    'the grace clock must survive one source clearing while the other source still holds needs-human true'
  );
});

test('once BOTH sources clear, the grace clock resets and no email fires', async () => {
  const reconciler = new NeedsHumanReconciler();
  const { sent, adapters } = mkAdapters();
  const notifier = new NeedsHumanEmailNotifier(mkConfig(), adapters);

  notifier.recordUpdates(reconciler.applyQuestionEvents([{ role: 'hardender', needsHuman: true }]), NOW);
  notifier.recordUpdates(reconciler.applyStuckRoles(['hardender']), NOW);
  notifier.recordUpdates(reconciler.applyQuestionEvents([{ role: 'hardender', needsHuman: false }]), NOW + 1000);
  notifier.recordUpdates(reconciler.applyStuckRoles([]), NOW + 2000);

  notifier.sweep(NOW + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 0, 'recovery on both sources must cancel the pending email');
});
