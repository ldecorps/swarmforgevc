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
exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS = void 0;
exports.isTimedOut = isTimedOut;
exports.shapeRunResult = shapeRunResult;
exports.runCommand = runCommand;
exports.readTmuxSocket = readTmuxSocket;
exports.listTmuxSessions = listTmuxSessions;
exports.getPaneBaseIndex = getPaneBaseIndex;
exports.paneTarget = paneTarget;
exports.resolveAgentPaneTarget = resolveAgentPaneTarget;
exports.getPaneCommand = getPaneCommand;
exports.getPanePid = getPanePid;
exports.capturePane = capturePane;
exports.setHistoryLimit = setHistoryLimit;
exports.setWindowSizeManual = setWindowSizeManual;
exports.resizeWindow = resizeWindow;
exports.sendKeys = sendKeys;
exports.hasRequiredRoleFields = hasRequiredRoleFields;
exports.parseRoleLine = parseRoleLine;
exports.readSwarmRoles = readSwarmRoles;
exports.sleepSync = sleepSync;
exports.respawnPaneForced = respawnPaneForced;
exports.respawnAgent = respawnAgent;
exports.sessionExists = sessionExists;
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const verifiedInject_1 = require("./verifiedInject");
// runCommand is synchronous and runs on the extension host's only JS thread:
// a child that never exits wedges the entire extension (tiles, webview
// messages, every timer). All callers are sub-second tmux commands, so a
// bounded default timeout turns any hang into a failed result instead.
exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS = 10_000;
// BL-104: split out of runCommand (complexity 8 -> under threshold). Pure
// and unit-tested directly, independent of an actual spawnSync call.
function isTimedOut(error) {
    return error !== undefined && error.code === 'ETIMEDOUT';
}
// BL-104: split out of runCommand alongside isTimedOut. Shapes a raw
// spawnSync-like result into the TmuxRunResult the rest of the codebase
// depends on (timeout stderr message, exit-code fallback).
function shapeRunResult(raw, command, timeoutMs) {
    const timedOut = isTimedOut(raw.error);
    const stderr = (raw.stderr ?? '').trimEnd();
    return {
        stdout: (raw.stdout ?? '').trimEnd(),
        stderr: timedOut
            ? [stderr, `${command} timed out after ${timeoutMs}ms`].filter(Boolean).join('\n')
            : stderr,
        exitCode: timedOut ? 1 : raw.status ?? 1,
    };
}
function runCommand(command, args, options = { encoding: 'utf8' }) {
    const result = cp.spawnSync(command, args, {
        timeout: exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS,
        ...options,
        encoding: 'utf8',
    });
    return shapeRunResult(result, command, options.timeout ?? exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS);
}
function readTmuxSocket(targetPath) {
    const socketFile = path.join(targetPath, '.swarmforge', 'tmux-socket');
    if (!fs.existsSync(socketFile)) {
        return undefined;
    }
    return fs.readFileSync(socketFile, 'utf8').trim();
}
function listTmuxSessions(socketPath) {
    const args = socketPath ? ['-S', socketPath, 'list-sessions'] : ['list-sessions'];
    return runCommand('tmux', args);
}
function getPaneBaseIndex(socketPath) {
    const result = runCommand('tmux', [
        '-S',
        socketPath,
        'show-window-options',
        '-gv',
        'pane-base-index',
    ]);
    const value = parseInt(result.stdout, 10);
    return Number.isFinite(value) ? value : 0;
}
function paneTarget(session, windowName, paneBaseIndex) {
    return `${session}:${windowName}.${paneBaseIndex}`;
}
function resolveAgentPaneTarget(socketPath, session, paneBaseIndex) {
    const result = runCommand('tmux', [
        '-S',
        socketPath,
        'list-windows',
        '-t',
        session,
        '-F',
        '#{window_index}',
    ]);
    if (result.exitCode !== 0 || !result.stdout.trim()) {
        return `${session}:0.${paneBaseIndex}`;
    }
    const windowIndex = result.stdout.trim().split('\n')[0];
    return `${session}:${windowIndex}.${paneBaseIndex}`;
}
function getPaneCommand(socketPath, target) {
    const result = runCommand('tmux', [
        '-S',
        socketPath,
        'display-message',
        '-p',
        '-t',
        target,
        '#{pane_current_command}',
    ]);
    if (result.exitCode !== 0) {
        return '';
    }
    return result.stdout.trim();
}
// BL-120: a `tmux respawn-pane` reuses the same socket and session name, so
// neither changes when a pane's agent process is relaunched - the pane's
// PID does, though, since respawn replaces the process running in it. Used
// to detect a respawn the tailer would otherwise treat as "nothing changed"
// and keep diffing fresh post-respawn content against stale retained state.
function getPanePid(socketPath, target) {
    const result = runCommand('tmux', [
        '-S',
        socketPath,
        'display-message',
        '-p',
        '-t',
        target,
        '#{pane_pid}',
    ]);
    if (result.exitCode !== 0) {
        return '';
    }
    return result.stdout.trim();
}
function capturePane(socketPath, target, startLine) {
    const args = ['-S', socketPath, 'capture-pane', '-p', '-e', '-t', target];
    if (startLine !== undefined) {
        args.push('-S', String(startLine));
    }
    return runCommand('tmux', args);
}
/**
 * Raise the tmux scrollback buffer (history-limit) so tiles can show more
 * "memory". Set globally (-g) so panes created after this — e.g. on respawn —
 * inherit the larger buffer, and on already-running panes the buffer grows
 * toward the new limit as fresh output arrives.
 */
function setHistoryLimit(socketPath, lines) {
    return runCommand('tmux', [
        '-S',
        socketPath,
        'set-option',
        '-g',
        'history-limit',
        String(lines),
    ]);
}
/**
 * Switch the tmux server to manual window sizing so resizeWindow sticks even
 * when no client is attached (headless swarm). Without this, tmux sizes windows
 * to the latest/attached client and snaps detached windows back to 80x24.
 */
function setWindowSizeManual(socketPath) {
    return runCommand('tmux', [
        '-S',
        socketPath,
        'set-option',
        '-g',
        'window-size',
        'manual',
    ]);
}
/**
 * Resize a window so its pane shows more lines. Headless tmux defaults to 80x24,
 * which caps each tile at 24 lines of a full-screen TUI; a taller pane makes the
 * agent re-render (SIGWINCH) into more rows and lets capture-pane return them.
 * Requires setWindowSizeManual to have been applied.
 */
function resizeWindow(socketPath, target, cols, rows) {
    return runCommand('tmux', [
        '-S',
        socketPath,
        'resize-window',
        '-t',
        target,
        '-x',
        String(cols),
        '-y',
        String(rows),
    ]);
}
function sendKeys(socketPath, target, keys, literal = false) {
    const args = ['-S', socketPath, 'send-keys', '-t', target];
    if (literal) {
        args.push('-l', '--', keys);
    }
    else {
        args.push(keys);
    }
    return runCommand('tmux', args);
}
// BL-104: split out of readSwarmRoles (complexity 9 -> under threshold).
// Pure and unit-tested directly, independent of the file-reading loop.
function hasRequiredRoleFields(role, session, displayName) {
    return Boolean(role) && Boolean(session) && Boolean(displayName);
}
// BL-104: split out alongside hasRequiredRoleFields — parses one
// sessions.tsv line into a SwarmRole, or undefined for a blank/malformed
// line. fallbackIndex mirrors the original's `roles.length + 1` (computed
// by the caller before the push, since a skipped line never increments it).
function parseRoleLine(line, fallbackIndex) {
    if (!line.trim()) {
        return undefined;
    }
    const [indexStr, role, session, displayName, agent] = line.split('\t');
    if (!hasRequiredRoleFields(role, session, displayName)) {
        return undefined;
    }
    return {
        index: parseInt(indexStr, 10) || fallbackIndex,
        role,
        session,
        displayName,
        agent: agent ?? 'unknown',
    };
}
function readSwarmRoles(targetPath) {
    const sessionsFile = path.join(targetPath, '.swarmforge', 'sessions.tsv');
    if (!fs.existsSync(sessionsFile)) {
        return [];
    }
    const lines = fs.readFileSync(sessionsFile, 'utf8').split('\n');
    const roles = [];
    for (const line of lines) {
        const parsed = parseRoleLine(line, roles.length + 1);
        if (parsed) {
            roles.push(parsed);
        }
    }
    return roles;
}
// Synchronous backoff wait for the retry loop below. The extension host is
// single-threaded and blocking here is deliberate and bounded (a few hundred
// ms, only on a verification retry) - the same tradeoff runCommand already
// makes with its blocking spawnSync calls.
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * Kills whatever is running in the pane and relaunches the role's launch
 * script directly in place, bypassing send-keys entirely. This is the only
 * recovery that works on a WEDGED TUI (process alive, all input ignored):
 * send-keys types into a dead input box and can never submit there.
 */
function respawnPaneForced(socketPath, target, launchScript) {
    return runCommand('tmux', [
        '-S',
        socketPath,
        'respawn-pane',
        '-k',
        '-t',
        target,
        `bash ${launchScript}`,
    ]);
}
function respawnAgent(targetPath, role) {
    const launchScript = path.join(targetPath, '.swarmforge', 'launch', `${role}.sh`);
    if (!fs.existsSync(launchScript)) {
        return { success: false, message: `No launch script found for role "${role}" at ${launchScript}` };
    }
    const socketPath = readTmuxSocket(targetPath);
    if (!socketPath) {
        return { success: false, message: `Cannot respawn "${role}": no tmux socket recorded (is the swarm running?)` };
    }
    const roleEntry = readSwarmRoles(targetPath).find((entry) => entry.role === role);
    if (!roleEntry) {
        return { success: false, message: `Cannot respawn "${role}": role not found in sessions.tsv` };
    }
    // The launch script runs `claude` in the foreground and only exits when the
    // agent does. It must run INSIDE the role's tmux pane — executing it here
    // would block the extension host's single JS thread until the agent exits,
    // freezing the whole extension, and leave the agent outside tmux where no
    // tile can see it.
    const target = resolveAgentPaneTarget(socketPath, roleEntry.session, getPaneBaseIndex(socketPath));
    return performVerifiedRespawn(socketPath, target, launchScript, role);
}
// BL-093: split out of respawnAgent (CRAP) - type-and-verify first (works
// for the common case: an idle/dead shell pane waiting to reattach). Only
// escalate to a forced pane kill+relaunch when verification exhausts its
// retries - i.e. the pane is a WEDGED live TUI that send-keys cannot reach -
// never on a healthy pane (a healthy pane confirms delivery on the first
// attempt).
function performVerifiedRespawn(socketPath, target, launchScript, role) {
    const command = `bash ${launchScript}`;
    let typeFailure;
    const result = (0, verifiedInject_1.sendInstructionVerified)({
        capturePane: () => {
            const captured = capturePane(socketPath, target);
            return captured.exitCode === 0 ? captured.stdout : '';
        },
        sendLiteral: (text) => {
            const typed = sendKeys(socketPath, target, text, true);
            if (typed.exitCode !== 0) {
                typeFailure = typed;
                return false;
            }
            return true;
        },
        sendEnter: () => {
            sendKeys(socketPath, target, 'Enter');
        },
        wait: sleepSync,
    }, command);
    if (typeFailure) {
        return { success: false, message: `Failed to respawn "${role}": ${typeFailure.stderr || typeFailure.stdout || `exit ${typeFailure.exitCode}`}` };
    }
    if (result.status === 'delivered') {
        return { success: true, message: `Agent "${role}" restarted in pane ${target}.` };
    }
    return escalateToForcedRespawn(socketPath, target, launchScript, role, result);
}
function escalateToForcedRespawn(socketPath, target, launchScript, role, result) {
    const forced = respawnPaneForced(socketPath, target, launchScript);
    if (forced.exitCode !== 0) {
        return {
            success: false,
            message: `Failed to respawn "${role}": send-keys did not submit (${result.reason}), and forced pane respawn also failed: ${forced.stderr || forced.stdout || `exit ${forced.exitCode}`}`,
        };
    }
    return {
        success: true,
        message: `Agent "${role}" was wedged (send-keys did not submit); forced a pane respawn in ${target}.`,
    };
}
function sessionExists(socketPath, session) {
    const result = runCommand('tmux', [
        '-S',
        socketPath,
        'has-session',
        '-t',
        session,
    ]);
    return result.exitCode === 0;
}
//# sourceMappingURL=tmuxClient.js.map