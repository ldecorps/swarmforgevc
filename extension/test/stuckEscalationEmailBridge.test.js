/**
 * BL-148: proves the full composition extension.ts wires together -
 * syncStuckEscalations (chaserMonitor.ts) feeding a NeedsHumanEmailNotifier
 * (notify/needsHumanEmailNotifier.ts) - without vscode or a SwarmPanel
 * instance anywhere in the path. That absence IS the wedge-alert-02 proof:
 * this composition cannot depend on the panel webview being open, because
 * nothing here ever references it.
 *
 * Root cause (BL-148): chase_sweep_lib.bb's stuck-in-process "alert"
 * escalation (BL-067) moved into the daemon when BL-146 ported the sweep
 * there, and started writing .swarmforge/daemon/chase-escalations.json
 * across the daemon/extension-host process boundary - but nothing on the
 * TS side ever read that file back. escalatedStuckRoles() (feeding the
 * panel's red border AND, before this fix, the panel-scoped email sweep)
 * was only ever updated by two narrower paths (BL-122 dead-letter-recovery
 * exhaustion, and the wedged-respawn-trigger fallback) - never by a real
 * BL-067 wedge. Compounding it, the email sweep itself only ran inside
 * SwarmPanel's own poll loop, which stops the instant the webview closes.
 * Fixed by: (1) syncStuckEscalations reads the daemon file every tick of
 * chaserMonitor's own panel-independent interval, and (2) a separate,
 * host-level NeedsHumanEmailNotifier (extension.ts's
 * ensureStuckEscalationNotifier) is fed and swept from that same tick.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { syncStuckEscalations } = require('../out/watchdog/chaserMonitor');
const { NeedsHumanEmailNotifier } = require('../out/notify/needsHumanEmailNotifier');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stuck-escalation-bridge-'));
}

function writeEscalations(targetPath, escalations) {
  const daemonDir = path.join(targetPath, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify(escalations));
}

function mkNotifier(overrides = {}) {
  const sent = [];
  const notifier = new NeedsHumanEmailNotifier(
    { enabled: true, graceSeconds: 60, cooldownSeconds: 600, to: 'human@example.com', from: 'onboarding@resend.dev' },
    {
      getSessionUrl: () => null,
      getTicketBadge: () => null,
      sendEmail: async (message) => {
        sent.push(message);
        return { success: true };
      },
      ...overrides,
    }
  );
  return { sent, notifier };
}

test('BL-148 wedge-alert-01: a daemon-marked wedge emits exactly one email once past the grace period', async () => {
  const target = mkTmp();
  const now = Date.parse('2026-07-06T18:44:00Z');
  writeEscalations(target, { hardender: true });
  const { sent, notifier } = mkNotifier();

  // Tick 1: the daemon's escalation is picked up, grace clock starts.
  syncStuckEscalations(target, ['hardender'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], now);
  });
  notifier.sweep(now);
  assert.equal(sent.length, 0, 'must not email before the grace period elapses');

  // Tick 2, still escalated, past the 60s grace period.
  const later = now + 61 * 1000;
  syncStuckEscalations(target, ['hardender'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], later);
  });
  notifier.sweep(later);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1, 'exactly one email for the confirmed wedge');
  assert.match(sent[0].text, /hardender is waiting/);

  // Tick 3: still escalated, still within cooldown - must not re-send.
  const evenLater = later + 5000;
  syncStuckEscalations(target, ['hardender'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], evenLater);
  });
  notifier.sweep(evenLater);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1, 'no repeat email while within cooldown');
});

test('BL-148 wedge-alert-03: a role that self-recovers before the grace period elapses never alerts', async () => {
  const target = mkTmp();
  const now = Date.parse('2026-07-06T18:44:00Z');
  writeEscalations(target, { hardender: true });
  const { sent, notifier } = mkNotifier();

  syncStuckEscalations(target, ['hardender'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], now);
  });

  // The daemon clears the escalation (handoffd.bb's write-escalation!
  // dissoc's the role) well before the 60s grace period would elapse.
  writeEscalations(target, {});
  const recovered = now + 10 * 1000;
  syncStuckEscalations(target, ['hardender'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], recovered);
  });

  notifier.sweep(now + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 0, 'a transient stuck state that self-recovers before the threshold must not alert');
});

test('BL-148: a role no roles.tsv/daemon file has ever mentioned never alerts (no crash, no false positive)', async () => {
  const target = mkTmp();
  const { sent, notifier } = mkNotifier();

  syncStuckEscalations(target, ['coder'], (role, escalated) => {
    notifier.recordUpdates([{ role, needsHuman: escalated }], Date.now());
  });
  notifier.sweep(Date.now() + 61 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 0);
});
