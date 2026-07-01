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
exports.DEV_ACTIVATION_MARKER_FILENAME = void 0;
exports.maybeWriteActivationMarker = maybeWriteActivationMarker;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Activation marker for the dev-host bounce script (BL-058).
 *
 * When the extension activates in Development extension mode, it drops a small
 * JSON marker into the extension repo so scripts/start-extension-dev.sh can
 * verify a fresh activation instead of trusting a blind delay. The path is
 * gitignored; production activation never writes it, so user repos stay clean.
 */
exports.DEV_ACTIVATION_MARKER_FILENAME = '.dev-activation.json';
function maybeWriteActivationMarker(isDevelopmentMode, extensionPath, pid = process.pid, now = new Date()) {
    if (!isDevelopmentMode) {
        return null;
    }
    const markerPath = path.join(extensionPath, exports.DEV_ACTIVATION_MARKER_FILENAME);
    const marker = { activatedAt: now.toISOString(), pid };
    try {
        fs.writeFileSync(markerPath, JSON.stringify(marker) + '\n');
        return markerPath;
    }
    catch {
        // The marker only serves the bounce script; a failed write must never
        // break activation. The script reports the missing fresh marker loudly.
        return null;
    }
}
//# sourceMappingURL=devActivationMarker.js.map