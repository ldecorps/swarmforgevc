'use strict';

const assert = require('node:assert/strict');
const {
  decideWakeDedup,
  mailboxFingerprintFromBasenames,
  loadWakeDedupDecision,
  recordWakeDedupInjection,
  readWakeDedupSidecar,
  computeMailboxFingerprintForRole,
} = require('../out/swarm/wakeDedup');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

describe('wakeDedup (BL-1191)', () => {
  it('fingerprints sorted handoff basenames', () => {
    const a = mailboxFingerprintFromBasenames(['b.handoff', 'a.handoff']);
    const b = mailboxFingerprintFromBasenames(['a.handoff', 'b.handoff']);
    assert.equal(a, b);
    assert.notEqual(a, '');
  });

  it('suppresses unchanged mailbox on extension path', () => {
    const root = mkTmpDir('wake-dedup-');
    const fp = 'fp-test';
    recordWakeDedupInjection(root, 'coordinator', fp, 1000);
    const decision = loadWakeDedupDecision(root, 'coordinator', fp, 200000);
    assert.equal(decision.action, 'suppress');
    assert.equal(decision.skipReason, 'unchanged-mailbox');
    const sidecar = readWakeDedupSidecar(root, 'coordinator');
    assert.equal(sidecar.fingerprint, fp);
  });

  it('decideWakeDedup cooldown branch', () => {
    const d = decideWakeDedup({
      fingerprint: 'fp-a',
      lastFingerprint: 'fp-a',
      lastInjectedAtMs: 1000,
      nowMs: 2000,
      cooldownMs: 120000,
    });
    assert.equal(d.skipReason, 'cooldown');
  });

  it('decideWakeDedup empty mailbox suppresses', () => {
    const d = decideWakeDedup({ fingerprint: '', nowMs: 1000 });
    assert.equal(d.action, 'suppress');
    assert.equal(d.skipReason, 'empty-mailbox');
  });

  it('decideWakeDedup injects fresh fingerprint', () => {
    const d = decideWakeDedup({
      fingerprint: 'fp-new',
      lastFingerprint: 'fp-old',
      lastInjectedAtMs: 0,
      nowMs: 1_000_000,
    });
    assert.equal(d.action, 'inject');
    assert.equal(d.skipReason, null);
  });

  it('decideWakeDedup unchanged mailbox outside cooldown', () => {
    const d = decideWakeDedup({
      fingerprint: 'fp-same',
      lastFingerprint: 'fp-same',
      lastInjectedAtMs: 1_000,
      nowMs: 1_000 + 200_000,
      cooldownMs: 120_000,
    });
    assert.equal(d.action, 'suppress');
    assert.equal(d.skipReason, 'unchanged-mailbox');
  });

  it('decideWakeDedup cooldown blocks new fingerprint within window', () => {
    const d = decideWakeDedup({
      fingerprint: 'fp-new',
      lastFingerprint: 'fp-old',
      lastInjectedAtMs: 5_000,
      nowMs: 10_000,
      cooldownMs: 120_000,
    });
    assert.equal(d.action, 'suppress');
    assert.equal(d.skipReason, 'cooldown');
  });

  it('readWakeDedupSidecar returns null for missing file', () => {
    const root = mkTmpDir('wake-dedup-missing-');
    assert.equal(readWakeDedupSidecar(root, 'coordinator'), null);
  });

  it('computeMailboxFingerprintForRole returns empty without roles.tsv', () => {
    const root = mkTmpDir('wake-dedup-role-');
    assert.equal(computeMailboxFingerprintForRole(root, 'coordinator'), '');
  });
});
