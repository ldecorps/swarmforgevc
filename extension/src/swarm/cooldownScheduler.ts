import * as fs from 'fs';

// BL-082: cooldown-aware wake scheduling. When a role reports token
// exhaustion with a reset time, the chaser must stop nudging that role until
// the reset time passes, then wake it exactly once when cooldown ends.

export interface CooldownEntry {
  untilMs: number;
  wokenForUntilMs?: number;
}

export type CooldownFileState = Record<string, CooldownEntry>;

/**
 * Parses a reported reset-time signal into an absolute epoch ms.
 * Accepts an ISO-8601 timestamp, or a bare "HH:MM" that resolves to the next
 * occurrence of that time at/after nowMs (today if still ahead, otherwise
 * tomorrow). Returns null for anything unparseable — callers must treat null
 * as "do not enter cooldown", never as permanent suppression (BL-082
 * malformed/missing scenario).
 */
export function parseResetTime(signalText: string | null | undefined, nowMs: number): number | null {
  if (!signalText) return null;

  const isoMatch = signalText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?/);
  if (isoMatch) {
    const raw = isoMatch[0];
    const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(raw);
    const parsedMs = new Date(hasZone ? raw : `${raw}Z`).getTime();
    if (!isNaN(parsedMs)) return parsedMs;
  }

  const hhmmMatch = signalText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmmMatch) {
    const hours = parseInt(hhmmMatch[1], 10);
    const minutes = parseInt(hhmmMatch[2], 10);
    const now = new Date(nowMs);
    const candidate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hours,
      minutes,
      0,
      0
    ));
    if (candidate.getTime() <= nowMs) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate.getTime();
  }

  return null;
}

/** True while nowMs is still before the recorded cooldown expiry. */
export function isCoolingDown(cooldownUntilMs: number | null | undefined, nowMs: number): boolean {
  return typeof cooldownUntilMs === 'number' && nowMs < cooldownUntilMs;
}

/**
 * True exactly once per cooldown window: when cooldown has elapsed and no
 * wake has been recorded for this specific untilMs yet. Comparing against
 * the untilMs (not just a boolean flag) means a later cooldown for the same
 * role fires its own wake instead of being silenced by a stale marker.
 */
export function shouldWakeOnExpiry(
  cooldownUntilMs: number | null | undefined,
  nowMs: number,
  wokenForUntilMs: number | null | undefined
): boolean {
  if (typeof cooldownUntilMs !== 'number') return false;
  return nowMs >= cooldownUntilMs && wokenForUntilMs !== cooldownUntilMs;
}

/** Human-readable diagnostics label, e.g. "cooldown until 18:00". */
export function formatCooldownLabel(cooldownUntilMs: number): string {
  const d = new Date(cooldownUntilMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `cooldown until ${hh}:${mm}`;
}

// ── Persistence (restart resilience) ────────────────────────────────────────

export function loadCooldownState(filePath: string): CooldownFileState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCooldownState(filePath: string, state: CooldownFileState): void {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function recordCooldown(filePath: string, role: string, untilMs: number): void {
  const state = loadCooldownState(filePath);
  state[role] = { untilMs };
  saveCooldownState(filePath, state);
}

export function markCooldownWoken(filePath: string, role: string, untilMs: number): void {
  const state = loadCooldownState(filePath);
  if (state[role]) {
    state[role] = { ...state[role], wokenForUntilMs: untilMs };
  }
  saveCooldownState(filePath, state);
}

export function clearCooldown(filePath: string, role: string): void {
  const state = loadCooldownState(filePath);
  delete state[role];
  saveCooldownState(filePath, state);
}

export function getCooldownUntilMs(filePath: string, role: string): number | null {
  const state = loadCooldownState(filePath);
  return state[role]?.untilMs ?? null;
}

export function getCooldownWokenMarker(filePath: string, role: string): number | null {
  const state = loadCooldownState(filePath);
  return state[role]?.wokenForUntilMs ?? null;
}
