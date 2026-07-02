"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaneTailer = exports.STALL_THRESHOLD_MS = void 0;
exports.normalizeHistoryLines = normalizeHistoryLines;
exports.normalizePaneRows = normalizePaneRows;
exports.rolesChanged = rolesChanged;
exports.isStalled = isStalled;
exports.mapInputToTmuxKey = mapInputToTmuxKey;
exports.mapSpecialKeyToTmux = mapSpecialKeyToTmux;
const tmuxClient_1 = require("../swarm/tmuxClient");
const inputLog_1 = require("../swarm/inputLog");
const humanInputTracker_1 = require("../swarm/humanInputTracker");
const agentPaneState_1 = require("./agentPaneState");
const ansi_1 = require("./ansi");
const needsHumanDetection_1 = require("./needsHumanDetection");
const DEFAULT_POLL_INTERVAL_MS = 200;
exports.STALL_THRESHOLD_MS = 120_000;
const DEFAULT_HISTORY_LINES = 5000;
const MAX_HISTORY_LINES = 50000;
// Headless tmux panes default to 80x24, capping each tile at 24 lines. Resize
// windows taller so the agent TUI re-renders into more rows.
const TILE_PANE_COLS = 120;
const DEFAULT_TILE_PANE_ROWS = 200;
const MIN_TILE_PANE_ROWS = 6;
const MAX_TILE_PANE_ROWS = 1000;
function normalizeHistoryLines(value) {
    if (value === undefined || value === null || value <= 0) {
        return DEFAULT_HISTORY_LINES;
    }
    return Math.min(value, MAX_HISTORY_LINES);
}
function normalizePaneRows(value) {
    if (value === undefined || value === null || value <= 0) {
        return DEFAULT_TILE_PANE_ROWS;
    }
    return Math.max(MIN_TILE_PANE_ROWS, Math.min(value, MAX_TILE_PANE_ROWS));
}
/**
 * True when the set of role names differs between two role lists (a role was
 * added or removed). Order-insensitive. Used to detect when a respawn adds a
 * role — e.g. QA — while reusing the same tmux socket, so the panel can create
 * the new tile instead of showing stale roles.
 */
function rolesChanged(prev, next) {
    if (prev.length !== next.length) {
        return true;
    }
    const prevNames = new Set(prev.map((r) => r.role));
    return next.some((r) => !prevNames.has(r.role));
}
function isStalled(lastChangedAt, now) {
    return now - lastChangedAt >= exports.STALL_THRESHOLD_MS;
}
class PaneTailer {
    targetPath;
    onOutput;
    onStall;
    onDead;
    onInputLogError;
    onRoles;
    onNeedsHuman;
    interval;
    lastText = new Map();
    lastChangedAt = new Map();
    stalledRoles = new Set();
    deadRoles = new Set();
    needsHumanRoles = new Set();
    liveRoles = new Set();
    paneBaseIndex = 0;
    roles = [];
    socketPath = '';
    historyLines;
    paneRows;
    rolePaneRows = new Map();
    constructor(targetPath, onOutput, onStall, onDead, onInputLogError, historyLines, onRoles, paneRows, onNeedsHuman) {
        this.targetPath = targetPath;
        this.onOutput = onOutput;
        this.onStall = onStall;
        this.onDead = onDead;
        this.onInputLogError = onInputLogError;
        this.onRoles = onRoles;
        this.onNeedsHuman = onNeedsHuman;
        this.historyLines = normalizeHistoryLines(historyLines);
        this.paneRows = normalizePaneRows(paneRows);
    }
    // Grow the scrollback buffer and make each agent window taller so tiles show
    // far more than the default 24 lines. Re-applied whenever the role set changes
    // so a newly added window (e.g. QA on respawn) is sized too.
    applyPaneSettings() {
        if (!this.socketPath) {
            return;
        }
        (0, tmuxClient_1.setHistoryLimit)(this.socketPath, this.historyLines);
        (0, tmuxClient_1.setWindowSizeManual)(this.socketPath);
        for (const role of this.roles) {
            const rows = this.rolePaneRows.get(role.role) ?? this.paneRows;
            (0, tmuxClient_1.resizeWindow)(this.socketPath, role.session, TILE_PANE_COLS, rows);
        }
    }
    start(pollMs = DEFAULT_POLL_INTERVAL_MS) {
        this.stop();
        this.refreshState();
        this.interval = setInterval(() => {
            this.poll();
        }, pollMs);
        this.poll();
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    refreshState() {
        this.socketPath = (0, tmuxClient_1.readTmuxSocket)(this.targetPath) ?? '';
        this.roles = (0, tmuxClient_1.readSwarmRoles)(this.targetPath);
        this.lastText.clear();
        this.lastChangedAt.clear();
        this.stalledRoles.clear();
        this.deadRoles.clear();
        this.liveRoles.clear();
        if (this.socketPath) {
            this.paneBaseIndex = (0, tmuxClient_1.getPaneBaseIndex)(this.socketPath);
            this.applyPaneSettings();
        }
    }
    getRoles() {
        return this.roles;
    }
    // Each tile measures and reports its OWN visible height (a selected tile is
    // taller than the rest, per BL-040/043/051), so the fit must be per-role:
    // resize only the pane that changed rather than re-applying one shared row
    // count to every role's pane.
    updatePaneRows(role, newPaneRows) {
        const normalized = normalizePaneRows(newPaneRows);
        if (this.rolePaneRows.get(role) === normalized) {
            return;
        }
        this.rolePaneRows.set(role, normalized);
        if (!this.socketPath) {
            return;
        }
        const target = this.roles.find((r) => r.role === role);
        if (!target) {
            return;
        }
        (0, tmuxClient_1.resizeWindow)(this.socketPath, target.session, TILE_PANE_COLS, normalized);
    }
    poll() {
        const latestSocket = (0, tmuxClient_1.readTmuxSocket)(this.targetPath) ?? '';
        if (latestSocket !== this.socketPath) {
            this.socketPath = latestSocket;
            this.roles = (0, tmuxClient_1.readSwarmRoles)(this.targetPath);
            this.lastText.clear();
            if (this.socketPath) {
                this.paneBaseIndex = (0, tmuxClient_1.getPaneBaseIndex)(this.socketPath);
                this.applyPaneSettings();
            }
            this.onRoles?.(this.roles);
        }
        else {
            // The socket file is reused across respawns, so a socket-path change is
            // not enough to notice a role being added/removed (e.g. QA appended after
            // the cleaner). Re-read roles.tsv each poll and refresh the panel when the
            // role set changes, so the new tile appears without a full relaunch.
            const latestRoles = (0, tmuxClient_1.readSwarmRoles)(this.targetPath);
            if (rolesChanged(this.roles, latestRoles)) {
                const liveNames = new Set(latestRoles.map((r) => r.role));
                for (const name of [...this.lastText.keys()]) {
                    if (!liveNames.has(name)) {
                        this.lastText.delete(name);
                    }
                }
                this.roles = latestRoles;
                this.applyPaneSettings();
                this.onRoles?.(this.roles);
            }
        }
        if (!this.socketPath) {
            return;
        }
        const updates = [];
        const deadEvents = [];
        for (const role of this.roles) {
            if (!(0, tmuxClient_1.sessionExists)(this.socketPath, role.session)) {
                const text = `Session "${role.session}" is not running.\n\nUse SwarmForge: Stop Swarm, then Launch Swarm.`;
                this.pushFullTextIfChanged(role, updates, text);
                if (this.liveRoles.has(role.role) && !this.deadRoles.has(role.role)) {
                    this.deadRoles.add(role.role);
                    deadEvents.push({ role: role.role, dead: true });
                }
                continue;
            }
            if (this.deadRoles.has(role.role)) {
                this.deadRoles.delete(role.role);
                deadEvents.push({ role: role.role, dead: false });
            }
            this.liveRoles.add(role.role);
            const target = (0, tmuxClient_1.resolveAgentPaneTarget)(this.socketPath, role.session, this.paneBaseIndex);
            const result = (0, tmuxClient_1.capturePane)(this.socketPath, target, -this.historyLines);
            if (result.exitCode !== 0) {
                const text = `Could not read tmux pane for ${role.displayName}.\n\nTry SwarmForge: Stop Swarm, then Launch Swarm.`;
                this.pushFullTextIfChanged(role, updates, text);
                continue;
            }
            const rawText = (0, ansi_1.stripAnsi)(result.stdout);
            const paneCommand = (0, tmuxClient_1.getPaneCommand)(this.socketPath, target);
            const statusOverlay = (0, agentPaneState_1.agentPaneStatusMessage)(paneCommand, rawText);
            const text = statusOverlay ?? rawText;
            const previous = this.lastText.get(role.role);
            if (text === previous) {
                continue;
            }
            this.lastText.set(role.role, text);
            this.lastChangedAt.set(role.role, Date.now());
            updates.push({
                role: role.role,
                displayName: role.displayName,
                text,
                full: true,
            });
        }
        if (updates.length > 0) {
            this.onOutput(updates);
        }
        if (this.onDead && deadEvents.length > 0) {
            this.onDead(deadEvents);
        }
        if (this.onStall) {
            const stallEvents = [];
            const now = Date.now();
            for (const role of this.roles) {
                const lastChanged = this.lastChangedAt.get(role.role);
                if (lastChanged === undefined) {
                    continue;
                }
                const stalled = isStalled(lastChanged, now);
                const wasStalled = this.stalledRoles.has(role.role);
                if (stalled !== wasStalled) {
                    if (stalled) {
                        this.stalledRoles.add(role.role);
                    }
                    else {
                        this.stalledRoles.delete(role.role);
                    }
                    stallEvents.push({ role: role.role, stalled });
                }
            }
            if (stallEvents.length > 0) {
                this.onStall(stallEvents);
            }
        }
        if (this.onNeedsHuman) {
            const needsHumanEvents = [];
            for (const role of this.roles) {
                const text = this.lastText.get(role.role);
                const needsHuman = (0, needsHumanDetection_1.detectNeedsHuman)(text);
                const wasNeedsHuman = this.needsHumanRoles.has(role.role);
                if (needsHuman !== wasNeedsHuman) {
                    if (needsHuman) {
                        this.needsHumanRoles.add(role.role);
                    }
                    else {
                        this.needsHumanRoles.delete(role.role);
                    }
                    needsHumanEvents.push({ role: role.role, needsHuman });
                }
            }
            if (needsHumanEvents.length > 0) {
                this.onNeedsHuman(needsHumanEvents);
            }
        }
    }
    pushFullTextIfChanged(role, updates, text) {
        if (this.lastText.get(role.role) !== text) {
            this.lastText.set(role.role, text);
            updates.push({
                role: role.role,
                displayName: role.displayName,
                text,
                full: true,
            });
        }
    }
    resolveTarget(roleName) {
        if (!this.socketPath) {
            return undefined;
        }
        const role = this.roles.find((r) => r.role === roleName);
        if (!role) {
            return undefined;
        }
        return (0, tmuxClient_1.resolveAgentPaneTarget)(this.socketPath, role.session, this.paneBaseIndex);
    }
    forwardInput(roleName, data) {
        const target = this.resolveTarget(roleName);
        if (!target) {
            return;
        }
        const mapped = mapInputToTmuxKey(data);
        (0, tmuxClient_1.sendKeys)(this.socketPath, target, mapped.key, mapped.literal);
        (0, humanInputTracker_1.recordHumanInput)(roleName);
        this.logInput(roleName, data);
    }
    forwardSpecialKey(roleName, key) {
        const target = this.resolveTarget(roleName);
        if (!target) {
            return;
        }
        const tmuxKey = mapSpecialKeyToTmux(key);
        if (tmuxKey) {
            (0, tmuxClient_1.sendKeys)(this.socketPath, target, tmuxKey);
            (0, humanInputTracker_1.recordHumanInput)(roleName);
            this.logInput(roleName, key);
        }
    }
    logInput(role, data) {
        try {
            (0, inputLog_1.appendInputEntry)(this.targetPath, role, data);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.onInputLogError?.(`Input log write failed: ${message}`);
        }
    }
}
exports.PaneTailer = PaneTailer;
function mapInputToTmuxKey(data) {
    if (data === '\r' || data === '\n') {
        return { key: 'Enter', literal: false };
    }
    if (data === '\x7f' || data === '\b') {
        return { key: 'BSpace', literal: false };
    }
    if (data === '\t') {
        return { key: 'Tab', literal: false };
    }
    if (data.length === 1 && data.charCodeAt(0) < 32) {
        const letter = String.fromCharCode(data.charCodeAt(0) + 64).toLowerCase();
        return { key: `C-${letter}`, literal: false };
    }
    return { key: data, literal: true };
}
const SPECIAL_KEY_MAP = {
    Enter: 'Enter',
    Backspace: 'BSpace',
    Tab: 'Tab',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PPage',
    PageDown: 'NPage',
    Delete: 'DC',
};
function mapSpecialKeyToTmux(key) {
    return SPECIAL_KEY_MAP[key];
}
//# sourceMappingURL=paneTailer.js.map