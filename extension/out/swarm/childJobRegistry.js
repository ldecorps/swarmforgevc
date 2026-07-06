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
exports.readTrackedJobs = readTrackedJobs;
exports.writeTrackedJobs = writeTrackedJobs;
exports.recordTrackedJob = recordTrackedJob;
exports.removeTrackedJob = removeTrackedJob;
exports.spawnTrackedJob = spawnTrackedJob;
exports.reapAllTrackedJobs = reapAllTrackedJobs;
exports.reapStaleTrackedJobs = reapStaleTrackedJobs;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const atomicWrite_1 = require("../util/atomicWrite");
function registryFile(swarmforgeDir) {
    return path.join(swarmforgeDir, 'child-jobs.json');
}
/** Absent or corrupt registry reads as empty - never throws, never blocks a caller. */
function readTrackedJobs(swarmforgeDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(registryFile(swarmforgeDir), 'utf8'));
        return Array.isArray(raw) ? raw : [];
    }
    catch {
        return [];
    }
}
function writeTrackedJobs(swarmforgeDir, entries) {
    (0, atomicWrite_1.atomicWrite)(registryFile(swarmforgeDir), JSON.stringify(entries, null, 2));
}
function recordTrackedJob(swarmforgeDir, entry) {
    const entries = readTrackedJobs(swarmforgeDir).filter((e) => e.pgid !== entry.pgid);
    entries.push(entry);
    writeTrackedJobs(swarmforgeDir, entries);
}
function removeTrackedJob(swarmforgeDir, pgid) {
    const entries = readTrackedJobs(swarmforgeDir).filter((e) => e.pgid !== pgid);
    writeTrackedJobs(swarmforgeDir, entries);
}
/**
 * Spawn-registry-01: wraps an already-detached spawn (spawnFn must pass
 * `detached: true` so `child.pid` is the new process GROUP's leader, i.e.
 * its pgid) with a durable registry entry, removed automatically on a
 * clean exit. spawnFn is injected so this is testable without a real child
 * process.
 */
function spawnTrackedJob(swarmforgeDir, spawnFn, options) {
    const child = spawnFn();
    if (typeof child.pid !== 'number') {
        return child;
    }
    const pgid = child.pid;
    recordTrackedJob(swarmforgeDir, {
        pgid,
        worktree: options.worktree,
        kind: options.kind,
        started_at: new Date().toISOString(),
        owner_host_pid: options.ownerHostPid,
    });
    child.on('exit', () => removeTrackedJob(swarmforgeDir, pgid));
    return child;
}
/**
 * deactivate-reap-02: signal every tracked group to terminate (SIGTERM,
 * escalating to SIGKILL after graceMs) and leave the registry empty. Best
 * effort per entry - one failing kill (already-dead group) must not stop
 * the rest from being reaped.
 */
function reapAllTrackedJobs(swarmforgeDir, killGroup, graceMs, scheduleEscalation = setTimeout) {
    const entries = readTrackedJobs(swarmforgeDir);
    for (const entry of entries) {
        try {
            killGroup(entry.pgid, 'SIGTERM');
        }
        catch {
            // already gone; nothing to escalate
            continue;
        }
        scheduleEscalation(() => {
            try {
                killGroup(entry.pgid, 'SIGKILL');
            }
            catch {
                // already reaped by SIGTERM
            }
        }, graceMs);
    }
    writeTrackedJobs(swarmforgeDir, []);
}
/**
 * startup-reaper-03: a host killed without deactivate() leaves stale
 * registry entries whose owner_host_pid is gone. Terminate those groups
 * and drop only those entries - a still-live owner's tracked job is left
 * running untouched.
 */
function reapStaleTrackedJobs(swarmforgeDir, isHostPidAlive, killGroup) {
    const entries = readTrackedJobs(swarmforgeDir);
    const survivors = [];
    for (const entry of entries) {
        if (isHostPidAlive(entry.owner_host_pid)) {
            survivors.push(entry);
            continue;
        }
        try {
            killGroup(entry.pgid, 'SIGTERM');
        }
        catch {
            // already gone
        }
    }
    writeTrackedJobs(swarmforgeDir, survivors);
}
//# sourceMappingURL=childJobRegistry.js.map