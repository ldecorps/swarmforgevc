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
exports.runCommand = runCommand;
exports.readTmuxSocket = readTmuxSocket;
exports.listTmuxSessions = listTmuxSessions;
exports.getPaneBaseIndex = getPaneBaseIndex;
exports.paneTarget = paneTarget;
exports.resolveAgentPaneTarget = resolveAgentPaneTarget;
exports.getPaneCommand = getPaneCommand;
exports.capturePane = capturePane;
exports.setHistoryLimit = setHistoryLimit;
exports.setWindowSizeManual = setWindowSizeManual;
exports.resizeWindow = resizeWindow;
exports.sendKeys = sendKeys;
exports.readSwarmRoles = readSwarmRoles;
exports.respawnAgent = respawnAgent;
exports.sessionExists = sessionExists;
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// runCommand is synchronous and runs on the extension host's only JS thread:
// a child that never exits wedges the entire extension (tiles, webview
// messages, every timer). All callers are sub-second tmux commands, so a
// bounded default timeout turns any hang into a failed result instead.
exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS = 10_000;
function runCommand(command, args, options = { encoding: 'utf8' }) {
    const result = cp.spawnSync(command, args, {
        timeout: exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS,
        ...options,
        encoding: 'utf8',
    });
    const timedOut = result.error !== undefined &&
        result.error.code === 'ETIMEDOUT';
    const stderr = (result.stderr ?? '').trimEnd();
    return {
        stdout: (result.stdout ?? '').trimEnd(),
        stderr: timedOut
            ? [stderr, `${command} timed out after ${options.timeout ?? exports.DEFAULT_RUN_COMMAND_TIMEOUT_MS}ms`]
                .filter(Boolean)
                .join('\n')
            : stderr,
        exitCode: timedOut ? 1 : result.status ?? 1,
    };
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
function readSwarmRoles(targetPath) {
    const sessionsFile = path.join(targetPath, '.swarmforge', 'sessions.tsv');
    if (!fs.existsSync(sessionsFile)) {
        return [];
    }
    const lines = fs.readFileSync(sessionsFile, 'utf8').split('\n');
    const roles = [];
    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }
        const [indexStr, role, session, displayName, agent] = line.split('\t');
        if (!role || !session || !displayName) {
            continue;
        }
        roles.push({
            index: parseInt(indexStr, 10) || roles.length + 1,
            role,
            session,
            displayName,
            agent: agent ?? 'unknown',
        });
    }
    return roles;
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
    const typed = sendKeys(socketPath, target, `bash ${launchScript}`, true);
    if (typed.exitCode !== 0) {
        return { success: false, message: `Failed to respawn "${role}": ${typed.stderr || typed.stdout || `exit ${typed.exitCode}`}` };
    }
    const submitted = sendKeys(socketPath, target, 'Enter');
    if (submitted.exitCode !== 0) {
        return { success: false, message: `Failed to respawn "${role}": ${submitted.stderr || submitted.stdout || `exit ${submitted.exitCode}`}` };
    }
    return { success: true, message: `Agent "${role}" restarted in pane ${target}.` };
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