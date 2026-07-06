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
exports.drainSentinelPath = drainSentinelPath;
exports.readBounceDrainState = readBounceDrainState;
exports.writeBounceDrainState = writeBounceDrainState;
exports.clearBounceDrainState = clearBounceDrainState;
exports.startBounceDrain = startBounceDrain;
exports.decideDrainAction = decideDrainAction;
exports.startBounceDrainWatcher = startBounceDrainWatcher;
exports.stopBounceDrainWatcher = stopBounceDrainWatcher;
exports.startGracefulBounceFileWatcher = startGracefulBounceFileWatcher;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const atomicWrite_1 = require("../util/atomicWrite");
const bounceWatcher_1 = require("./bounceWatcher");
const SENTINEL_RELATIVE_PATH = ['.swarmforge', 'bounce-drain.json'];
const GRACEFUL_TRIGGER_FILENAME = 'bounce-graceful';
function drainSentinelPath(targetPath) {
    return path.join(targetPath, ...SENTINEL_RELATIVE_PATH);
}
function readBounceDrainState(targetPath) {
    try {
        const raw = fs.readFileSync(drainSentinelPath(targetPath), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed &&
            (0, bounceWatcher_1.isBounceType)(parsed.bounceType) &&
            typeof parsed.startedAt === 'string' &&
            typeof parsed.timeoutSeconds === 'number') {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
// Write bounce drain state atomically (via temp+rename) so a reader never
// observes a partially-written file.
function writeBounceDrainState(targetPath, state) {
    (0, atomicWrite_1.atomicWrite)(drainSentinelPath(targetPath), JSON.stringify(state, null, 2));
}
function clearBounceDrainState(targetPath) {
    const target = drainSentinelPath(targetPath);
    if (fs.existsSync(target)) {
        fs.unlinkSync(target);
    }
}
function startBounceDrain(targetPath, bounceType, timeoutSeconds, nowIso = new Date().toISOString()) {
    writeBounceDrainState(targetPath, { bounceType, startedAt: nowIso, timeoutSeconds });
}
function decideDrainAction(roles, startedAtMs, nowMs, timeoutSeconds) {
    const allDrained = roles.every((r) => !r.hasInProcessWork && r.idle);
    if (allDrained) {
        return 'bounce';
    }
    const elapsedSeconds = (nowMs - startedAtMs) / 1000;
    if (elapsedSeconds >= timeoutSeconds) {
        return 'timeout';
    }
    return 'wait';
}
function startBounceDrainWatcher(config, adapters) {
    // Prompt the human once per drain session, not once per poll: the sentinel
    // itself only carries the state a role script needs, not UI state. `bounced`
    // guards the same way: the caller (extension.ts) stops this watcher and
    // clears the sentinel synchronously inside onBounce, so in practice a
    // second tick never reaches here — but that is an implicit contract with
    // the one current caller, not something this primitive enforces on its
    // own, so it is guarded directly rather than relying on it.
    let timeoutPrompted = false;
    let bounced = false;
    const intervalId = setInterval(() => {
        const state = readBounceDrainState(config.targetPath);
        if (!state) {
            timeoutPrompted = false;
            bounced = false;
            return;
        }
        const startedAtMs = Date.parse(state.startedAt);
        const roles = adapters.getRoleStatuses();
        const decision = decideDrainAction(roles, startedAtMs, Date.now(), state.timeoutSeconds);
        if (decision === 'bounce' && !bounced) {
            bounced = true;
            adapters.onBounce(state.bounceType);
        }
        else if (decision === 'timeout' && !timeoutPrompted) {
            timeoutPrompted = true;
            const busyRoles = roles.filter((r) => r.hasInProcessWork || !r.idle).map((r) => r.role);
            adapters.onTimeout(state.bounceType, busyRoles);
        }
    }, config.pollIntervalSeconds * 1000);
    return intervalId;
}
function stopBounceDrainWatcher(intervalId) {
    if (intervalId) {
        clearInterval(intervalId);
    }
}
// ── remote sentinel variant ("plus a variant of the existing remote-bounce
// sentinel", BL-069) — mirrors bounceWatcher.ts's own fs.watch pattern for a
// second, distinct trigger file so the immediate-bounce path is untouched.
function startGracefulBounceFileWatcher(targetPath, onGracefulBounce, onError) {
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    const triggerFilePath = path.join(swarmforgeDir, GRACEFUL_TRIGGER_FILENAME);
    if (!fs.existsSync(swarmforgeDir)) {
        return null;
    }
    const watcher = fs.watch(swarmforgeDir, (_eventType, filename) => {
        if (filename !== GRACEFUL_TRIGGER_FILENAME) {
            return;
        }
        setTimeout(() => {
            if (fs.existsSync(triggerFilePath)) {
                (0, bounceWatcher_1.processBounceFile)(triggerFilePath, onGracefulBounce, onError);
            }
        }, 50);
    });
    return watcher;
}
//# sourceMappingURL=bounceDrain.js.map