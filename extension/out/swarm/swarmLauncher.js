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
exports.isSwarmReady = isSwarmReady;
exports.augmentPath = augmentPath;
exports.buildLaunchEnv = buildLaunchEnv;
exports.launchSwarm = launchSwarm;
exports.waitForSwarmReady = waitForSwarmReady;
// pipeline smoke test BL-029
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tmuxClient_1 = require("./tmuxClient");
const swarmStopper_1 = require("./swarmStopper");
const SWARM_LAUNCH_SUCCESS_MESSAGE = 'Swarm launched successfully.';
function isSwarmReady(targetPath) {
    const socket = (0, tmuxClient_1.readTmuxSocket)(targetPath);
    if (!socket) {
        return false;
    }
    if ((0, tmuxClient_1.listTmuxSessions)(socket).exitCode !== 0) {
        return false;
    }
    const roles = (0, tmuxClient_1.readSwarmRoles)(targetPath);
    if (roles.length === 0) {
        return false;
    }
    return roles.every((role) => (0, tmuxClient_1.sessionExists)(socket, role.session));
}
// Dirs where tmux, bb (babashka), and claude are commonly installed. A
// Dock/Finder-launched VS Code inherits a minimal PATH without these, so the
// spawned ./swarm cannot find its tools and the launch silently fails.
const COMMON_TOOL_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];
function augmentPath(currentPath) {
    const existing = (currentPath ?? '').split(':').filter((p) => p.length > 0);
    const missing = COMMON_TOOL_PATHS.filter((dir) => !existing.includes(dir));
    return [...missing, ...existing].join(':');
}
function buildLaunchEnv(runName) {
    const env = {
        ...process.env,
        SWARMFORGE_TERMINAL: 'none',
        PATH: augmentPath(process.env.PATH),
    };
    if (runName) {
        env['SWARM_RUN_NAME'] = `swarm/${runName}`;
    }
    else {
        delete env['SWARM_RUN_NAME'];
    }
    return env;
}
async function launchSwarm(targetPath, runName, readyTimeoutMs = 120_000) {
    const swarmScript = path.join(targetPath, 'swarm');
    if (!fs.existsSync(swarmScript)) {
        return {
            success: false,
            message: `No ./swarm wrapper found at ${swarmScript}`,
            targetPath,
        };
    }
    // A previous run's tmux-socket/sessions.tsv can satisfy isSwarmReady and
    // make this launch report success against a dead or dying swarm. If the
    // swarm is not currently ready, tear down whatever answers on the old
    // socket and remove the marker files, so readiness below can only be
    // satisfied by the state the NEW ./swarm run writes.
    if (!isSwarmReady(targetPath)) {
        (0, swarmStopper_1.clearStaleSwarmState)(targetPath);
    }
    return new Promise((resolve) => {
        const child = cp.spawn(swarmScript, [targetPath], {
            cwd: targetPath,
            env: buildLaunchEnv(runName),
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
        let settled = false;
        let stderr = '';
        let stdout = '';
        const cleanup = () => {
            clearTimeout(deadline);
            clearInterval(poll);
        };
        const finish = (success, message) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve({ success, message, targetPath });
        };
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
            if (stdout.includes('SwarmForge is ready') &&
                isSwarmReady(targetPath)) {
                finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
            }
        });
        child.on('error', (err) => {
            finish(false, `Failed to start swarm: ${err.message}`);
        });
        child.on('close', (code) => {
            if (settled) {
                return;
            }
            if (isSwarmReady(targetPath)) {
                finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
                return;
            }
            finish(false, `Swarm launch failed: ${stderr || stdout || `exit code ${code ?? 'unknown'}`}`);
        });
        const deadline = setTimeout(() => {
            if (isSwarmReady(targetPath)) {
                finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
            }
            else {
                finish(false, 'Timed out waiting for swarm to become ready.');
            }
        }, readyTimeoutMs);
        const poll = setInterval(() => {
            if (isSwarmReady(targetPath)) {
                finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
            }
        }, 500);
    });
}
function waitForSwarmReady(targetPath, timeoutMs = 120_000, pollMs = 500) {
    if (isSwarmReady(targetPath)) {
        return Promise.resolve(true);
    }
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const check = () => {
            if (isSwarmReady(targetPath)) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(check, pollMs);
        };
        check();
    });
}
//# sourceMappingURL=swarmLauncher.js.map