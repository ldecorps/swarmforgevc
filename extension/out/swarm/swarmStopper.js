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
exports.buildKillSessionArgs = buildKillSessionArgs;
exports.clearSwarmStateFiles = clearSwarmStateFiles;
exports.clearStaleSwarmState = clearStaleSwarmState;
exports.stopSwarm = stopSwarm;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tmuxClient_1 = require("./tmuxClient");
const DAEMON_PID_SUBPATH = path.join('.swarmforge', 'daemon', 'handoffd.pid');
const DECIMAL_RADIX = 10;
function buildKillSessionArgs(socketPath, sessions) {
    return sessions.map((session) => ['-S', socketPath, 'kill-session', '-t', session]);
}
/**
 * Remove the swarm's state marker files so a stale previous run can never
 * satisfy isSwarmReady for a new launch. Safe to call when files are absent.
 */
function clearSwarmStateFiles(targetPath) {
    for (const rel of [
        path.join('.swarmforge', 'tmux-socket'),
        path.join('.swarmforge', 'sessions.tsv'),
    ]) {
        const file = path.join(targetPath, rel);
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        }
        catch {
            // best-effort cleanup; never block stop/launch on it
        }
    }
}
/**
 * Best-effort teardown of a swarm that is not (fully) alive: kill whatever
 * tmux server answers on the recorded socket, then remove the state marker
 * files. Used before a fresh launch so readiness can only be satisfied by
 * the NEW run's state.
 */
function clearStaleSwarmState(targetPath) {
    const socketPath = (0, tmuxClient_1.readTmuxSocket)(targetPath);
    if (socketPath) {
        (0, tmuxClient_1.runCommand)('tmux', ['-S', socketPath, 'kill-server']);
    }
    clearSwarmStateFiles(targetPath);
}
function stopHandoffDaemon(targetPath) {
    const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
    if (!fs.existsSync(daemonPidFile)) {
        return;
    }
    try {
        const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8').trim(), DECIMAL_RADIX);
        if (Number.isFinite(pid) && pid > 0) {
            process.kill(pid, 'SIGTERM');
        }
    }
    catch {
        // pid already gone or unreadable
    }
}
/**
 * Idempotent stop: stopping an already-stopped (or crashed) swarm is a
 * success, and always leaves the state files cleared so the next launch
 * starts from a clean slate.
 */
function stopSwarm(targetPath) {
    const socketPath = (0, tmuxClient_1.readTmuxSocket)(targetPath);
    if (!socketPath) {
        clearSwarmStateFiles(targetPath);
        stopHandoffDaemon(targetPath);
        return {
            success: true,
            message: 'Swarm already stopped (no tmux socket); state cleared.',
            sessionsKilled: [],
        };
    }
    const roles = (0, tmuxClient_1.readSwarmRoles)(targetPath);
    const killed = [];
    const sessions = roles.map((r) => r.session);
    for (const args of buildKillSessionArgs(socketPath, sessions)) {
        const result = (0, tmuxClient_1.runCommand)('tmux', args);
        if (result.exitCode === 0) {
            killed.push(args[args.length - 1]);
        }
    }
    // Kill the server itself so orphan sessions (e.g. from a run whose
    // sessions.tsv went stale) cannot survive into the next launch.
    (0, tmuxClient_1.runCommand)('tmux', ['-S', socketPath, 'kill-server']);
    stopHandoffDaemon(targetPath);
    clearSwarmStateFiles(targetPath);
    if (killed.length === 0) {
        return {
            success: true,
            message: 'No live sessions found (already stopped); stale swarm state cleared.',
            sessionsKilled: [],
        };
    }
    return {
        success: true,
        message: `Stopped ${killed.length} session(s): ${killed.join(', ')}`,
        sessionsKilled: killed,
    };
}
//# sourceMappingURL=swarmStopper.js.map