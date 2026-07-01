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
exports.stopSwarm = stopSwarm;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tmuxClient_1 = require("./tmuxClient");
const DAEMON_PID_SUBPATH = path.join('.swarmforge', 'daemon', 'handoffd.pid');
const DECIMAL_RADIX = 10;
function buildKillSessionArgs(socketPath, sessions) {
    return sessions.map((session) => ['-S', socketPath, 'kill-session', '-t', session]);
}
function stopSwarm(targetPath) {
    const socketPath = (0, tmuxClient_1.readTmuxSocket)(targetPath);
    if (!socketPath) {
        return {
            success: false,
            message: 'No tmux socket found — is the swarm running?',
            sessionsKilled: [],
        };
    }
    const roles = (0, tmuxClient_1.readSwarmRoles)(targetPath);
    if (roles.length === 0) {
        return {
            success: false,
            message: 'No sessions found — is the swarm running?',
            sessionsKilled: [],
        };
    }
    const killed = [];
    const sessions = roles.map((r) => r.session);
    for (const args of buildKillSessionArgs(socketPath, sessions)) {
        const result = (0, tmuxClient_1.runCommand)('tmux', args);
        if (result.exitCode === 0) {
            killed.push(args[args.length - 1]);
        }
    }
    const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
    if (fs.existsSync(daemonPidFile)) {
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
    if (killed.length === 0) {
        return {
            success: false,
            message: 'No sessions could be stopped (already stopped?).',
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