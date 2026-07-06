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
exports.readStateDump = readStateDump;
exports.readPreviousStateDump = readPreviousStateDump;
exports.writeStateDump = writeStateDump;
exports.startPeriodicStateDump = startPeriodicStateDump;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const atomicWrite_1 = require("../util/atomicWrite");
const DUMPS_SUBDIR = 'dumps';
const CURRENT_FILE = 'extension-state.json';
const PREVIOUS_FILE = 'extension-state.previous.json';
function dumpsDir(swarmforgeDir) {
    return path.join(swarmforgeDir, DUMPS_SUBDIR);
}
function currentFile(swarmforgeDir) {
    return path.join(dumpsDir(swarmforgeDir), CURRENT_FILE);
}
function previousFile(swarmforgeDir) {
    return path.join(dumpsDir(swarmforgeDir), PREVIOUS_FILE);
}
function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    catch {
        return undefined;
    }
}
function readStateDump(swarmforgeDir) {
    return readJson(currentFile(swarmforgeDir));
}
function readPreviousStateDump(swarmforgeDir) {
    return readJson(previousFile(swarmforgeDir));
}
/**
 * state-dump-01/04: writes the new snapshot as current, first rotating
 * whatever was current into the previous slot so a dump is never clobbered
 * without at least the prior one surviving. Best-effort: a write failure
 * (e.g. an unwritable path) is swallowed, never thrown - dump writing must
 * never block or delay shutdown.
 */
function writeStateDump(swarmforgeDir, snapshot) {
    try {
        const current = currentFile(swarmforgeDir);
        if (fs.existsSync(current)) {
            fs.mkdirSync(dumpsDir(swarmforgeDir), { recursive: true });
            fs.copyFileSync(current, previousFile(swarmforgeDir));
        }
        (0, atomicWrite_1.atomicWrite)(current, JSON.stringify(snapshot, null, 2));
    }
    catch {
        // best-effort: never let dump writing block or fail shutdown/activation
    }
}
/**
 * state-dump-02: a periodically-updated snapshot survives an abrupt host
 * kill that never runs deactivate(). scheduleTick/clearTick are injected so
 * this is testable without a real timer (per the no-real-timers-in-tests
 * rule) - production callers pass setInterval/clearInterval.
 */
function startPeriodicStateDump(swarmforgeDir, getSnapshot, intervalMs, scheduleTick, clearTick) {
    const handle = scheduleTick(() => writeStateDump(swarmforgeDir, getSnapshot()), intervalMs);
    return () => clearTick(handle);
}
//# sourceMappingURL=stateDump.js.map