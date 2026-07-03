"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseResetTime = parseResetTime;
exports.isCoolingDown = isCoolingDown;
exports.shouldWakeOnExpiry = shouldWakeOnExpiry;
exports.formatCooldownLabel = formatCooldownLabel;
exports.loadCooldownState = loadCooldownState;
exports.recordCooldown = recordCooldown;
exports.markCooldownWoken = markCooldownWoken;
exports.clearCooldown = clearCooldown;
exports.getCooldownUntilMs = getCooldownUntilMs;
exports.getCooldownWokenMarker = getCooldownWokenMarker;
const fs = __importStar(require("fs"));
/**
 * Parses a reported reset-time signal into an absolute epoch ms.
 * Accepts an ISO-8601 timestamp, or a bare "HH:MM" that resolves to the next
 * occurrence of that time at/after nowMs (today if still ahead, otherwise
 * tomorrow). Returns null for anything unparseable — callers must treat null
 * as "do not enter cooldown", never as permanent suppression (BL-082
 * malformed/missing scenario).
 */
function parseIsoResetTime(signalText) {
    const isoMatch = signalText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?/);
    if (!isoMatch)
        return null;
    const raw = isoMatch[0];
    const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(raw);
    const parsedMs = new Date(hasZone ? raw : `${raw}Z`).getTime();
    return isNaN(parsedMs) ? null : parsedMs;
}
function parseHhmmResetTime(signalText, nowMs) {
    const hhmmMatch = signalText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (!hhmmMatch)
        return null;
    const hours = parseInt(hhmmMatch[1], 10);
    const minutes = parseInt(hhmmMatch[2], 10);
    const now = new Date(nowMs);
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0, 0));
    if (candidate.getTime() <= nowMs) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate.getTime();
}
function parseResetTime(signalText, nowMs) {
    if (!signalText)
        return null;
    return parseIsoResetTime(signalText) ?? parseHhmmResetTime(signalText, nowMs);
}
/** True while nowMs is still before the recorded cooldown expiry. */
function isCoolingDown(cooldownUntilMs, nowMs) {
    return typeof cooldownUntilMs === 'number' && nowMs < cooldownUntilMs;
}
/**
 * True exactly once per cooldown window: when cooldown has elapsed and no
 * wake has been recorded for this specific untilMs yet. Comparing against
 * the untilMs (not just a boolean flag) means a later cooldown for the same
 * role fires its own wake instead of being silenced by a stale marker.
 */
function shouldWakeOnExpiry(cooldownUntilMs, nowMs, wokenForUntilMs) {
    if (typeof cooldownUntilMs !== 'number')
        return false;
    return nowMs >= cooldownUntilMs && wokenForUntilMs !== cooldownUntilMs;
}
/** Human-readable diagnostics label, e.g. "cooldown until 18:00". */
function formatCooldownLabel(cooldownUntilMs) {
    const d = new Date(cooldownUntilMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `cooldown until ${hh}:${mm}`;
}
// ── Persistence (restart resilience) ────────────────────────────────────────
function loadCooldownState(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function saveCooldownState(filePath, state) {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}
function recordCooldown(filePath, role, untilMs) {
    const state = loadCooldownState(filePath);
    state[role] = { untilMs };
    saveCooldownState(filePath, state);
}
function markCooldownWoken(filePath, role, untilMs) {
    const state = loadCooldownState(filePath);
    if (state[role]) {
        state[role] = { ...state[role], wokenForUntilMs: untilMs };
    }
    saveCooldownState(filePath, state);
}
function clearCooldown(filePath, role) {
    const state = loadCooldownState(filePath);
    delete state[role];
    saveCooldownState(filePath, state);
}
function getCooldownUntilMs(filePath, role) {
    const state = loadCooldownState(filePath);
    return state[role]?.untilMs ?? null;
}
function getCooldownWokenMarker(filePath, role) {
    const state = loadCooldownState(filePath);
    return state[role]?.wokenForUntilMs ?? null;
}
//# sourceMappingURL=cooldownScheduler.js.map