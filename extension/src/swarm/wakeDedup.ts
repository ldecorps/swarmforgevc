'use strict';

// BL-1191: pure wake-dedup decision + shared sidecar I/O (mirrors wake_dedup_lib.bb).

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mailboxDir, parseRolesTsv } from './swarmState';

export const DEFAULT_WAKE_DEDUP_COOLDOWN_MS = 120_000;

export type WakeDedupDecision = {
  action: 'inject' | 'suppress';
  skipReason: string | null;
  fingerprint: string;
};

export type WakeDedupSidecar = {
  fingerprint: string;
  lastInjectedAtMs: number;
};

function suppressDecision(skipReason: string, fingerprint: string): WakeDedupDecision {
  return { action: 'suppress', skipReason, fingerprint };
}

function injectDecision(fingerprint: string): WakeDedupDecision {
  return { action: 'inject', skipReason: null, fingerprint };
}

function decideSameFingerprint(
  fingerprint: string,
  lastFingerprint: string,
  withinCooldown: boolean
): WakeDedupDecision | null {
  if (fingerprint !== lastFingerprint || !lastFingerprint) {
    return null;
  }
  if (withinCooldown) {
    return suppressDecision('cooldown', fingerprint);
  }
  return suppressDecision('unchanged-mailbox', fingerprint);
}

function decideAfterFingerprintKnown(
  fingerprint: string,
  lastFingerprint: string,
  withinCooldown: boolean
): WakeDedupDecision {
  const sameFp = decideSameFingerprint(fingerprint, lastFingerprint, withinCooldown);
  if (sameFp) {
    return sameFp;
  }
  if (withinCooldown) {
    return suppressDecision('cooldown', fingerprint);
  }
  return injectDecision(fingerprint);
}

function parseWakeDedupInput(args: {
  fingerprint: string;
  lastFingerprint?: string | null;
  lastInjectedAtMs?: number | null;
  nowMs: number;
  cooldownMs?: number;
}): { fingerprint: string; lastFingerprint: string; withinCooldown: boolean } {
  const cooldownMs = args.cooldownMs ?? DEFAULT_WAKE_DEDUP_COOLDOWN_MS;
  const lastAt = args.lastInjectedAtMs ?? 0;
  return {
    fingerprint: String(args.fingerprint ?? ''),
    lastFingerprint: String(args.lastFingerprint ?? ''),
    withinCooldown: lastAt > 0 && args.nowMs - lastAt < cooldownMs,
  };
}

export function decideWakeDedup(args: {
  fingerprint: string;
  lastFingerprint?: string | null;
  lastInjectedAtMs?: number | null;
  nowMs: number;
  cooldownMs?: number;
}): WakeDedupDecision {
  const input = parseWakeDedupInput(args);
  if (!input.fingerprint) {
    return suppressDecision('empty-mailbox', input.fingerprint);
  }
  return decideAfterFingerprintKnown(input.fingerprint, input.lastFingerprint, input.withinCooldown);
}

export function mailboxFingerprintFromBasenames(basenames: string[]): string {
  const names = [...basenames].sort();
  if (names.length === 0) return '';
  return crypto.createHash('sha256').update(names.join('\n'), 'utf8').digest('hex');
}

export function wakeDedupSidecarPath(repoRoot: string, role: string): string {
  return path.join(repoRoot, '.swarmforge', 'daemon', 'wake-dedup', `${role}.json`);
}

export function readWakeDedupSidecar(repoRoot: string, role: string): WakeDedupSidecar | null {
  const file = wakeDedupSidecarPath(repoRoot, role);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as WakeDedupSidecar;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      fingerprint: String(parsed.fingerprint ?? ''),
      lastInjectedAtMs: Number(parsed.lastInjectedAtMs ?? 0),
    };
  } catch {
    return null;
  }
}

export function writeWakeDedupSidecar(
  repoRoot: string,
  role: string,
  sidecar: WakeDedupSidecar
): void {
  const file = wakeDedupSidecarPath(repoRoot, role);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        fingerprint: String(sidecar.fingerprint),
        lastInjectedAtMs: Number(sidecar.lastInjectedAtMs),
      },
      null,
      2
    ),
    'utf8'
  );
}

export function loadWakeDedupDecision(
  repoRoot: string,
  role: string,
  fingerprint: string,
  nowMs: number,
  cooldownMs?: number
): WakeDedupDecision {
  const sidecar = readWakeDedupSidecar(repoRoot, role);
  return decideWakeDedup({
    fingerprint,
    lastFingerprint: sidecar?.fingerprint,
    lastInjectedAtMs: sidecar?.lastInjectedAtMs,
    nowMs,
    cooldownMs,
  });
}

export function recordWakeDedupInjection(
  repoRoot: string,
  role: string,
  fingerprint: string,
  nowMs: number
): void {
  writeWakeDedupSidecar(repoRoot, role, { fingerprint, lastInjectedAtMs: nowMs });
}

export function listHandoffBasenames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.handoff'))
      .sort();
  } catch {
    return [];
  }
}

export function computeMailboxFingerprintFromDirs(newDir: string, inProcessDir: string): string {
  return mailboxFingerprintFromBasenames([
    ...listHandoffBasenames(newDir),
    ...listHandoffBasenames(inProcessDir),
  ]);
}

export function computeMailboxFingerprintForRole(repoRoot: string, role: string): string {
  const rolesFile = path.join(repoRoot, '.swarmforge', 'roles.tsv');
  let entries;
  try {
    entries = parseRolesTsv(fs.readFileSync(rolesFile, 'utf8'));
  } catch {
    return '';
  }
  const roleEntry = entries.find((entry) => entry.role === role);
  if (!roleEntry) {
    return '';
  }
  return computeMailboxFingerprintFromDirs(
    mailboxDir(roleEntry, 'inbox', 'new'),
    mailboxDir(roleEntry, 'inbox', 'in_process')
  );
}
