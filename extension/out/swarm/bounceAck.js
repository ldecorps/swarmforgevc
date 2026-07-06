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
exports.bounceAckPath = bounceAckPath;
exports.writeBounceAck = writeBounceAck;
exports.readBounceAck = readBounceAck;
exports.clearBounceAck = clearBounceAck;
exports.isBounceRequestStale = isBounceRequestStale;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const atomicWrite_1 = require("../util/atomicWrite");
const bounceWatcher_1 = require("./bounceWatcher");
const ACK_RELATIVE_PATH = ['.swarmforge', 'bounce-ack.json'];
function bounceAckPath(targetPath) {
    return path.join(targetPath, ...ACK_RELATIVE_PATH);
}
function isBouncePhase(value) {
    return (value === 'draining' ||
        value === 'stopping' ||
        value === 'relaunching' ||
        value === 'done' ||
        value === 'failed');
}
// Write bounce ack state atomically (via temp+rename) so a reader never
// observes a partially-written file.
function writeBounceAck(targetPath, state) {
    (0, atomicWrite_1.atomicWrite)(bounceAckPath(targetPath), JSON.stringify(state, null, 2));
}
function readBounceAck(targetPath) {
    try {
        const raw = fs.readFileSync(bounceAckPath(targetPath), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed &&
            (0, bounceWatcher_1.isBounceType)(parsed.bounceType) &&
            isBouncePhase(parsed.phase) &&
            typeof parsed.updatedAt === 'string') {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function clearBounceAck(targetPath) {
    const target = bounceAckPath(targetPath);
    if (fs.existsSync(target)) {
        fs.unlinkSync(target);
    }
}
// Pure decision (BL-107 no-listener-03): a bounce request is stale/unheeded
// once its sentinel has sat unprocessed for at least maxAgeMs. Takes an
// explicit clock (sentinelWrittenAtMs, nowMs) rather than touching the
// filesystem so it stays a fast, deterministic unit.
function isBounceRequestStale(sentinelWrittenAtMs, nowMs, maxAgeMs) {
    return nowMs - sentinelWrittenAtMs >= maxAgeMs;
}
//# sourceMappingURL=bounceAck.js.map