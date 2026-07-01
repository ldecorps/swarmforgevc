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
exports.parseBounceFile = parseBounceFile;
exports.processBounceFile = processBounceFile;
exports.startBounceWatcher = startBounceWatcher;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function parseBounceFile(content) {
    const trimmed = content.trim();
    if (trimmed === 'swarm') {
        return { valid: true, bounceType: 'swarm' };
    }
    if (trimmed === 'extension') {
        return { valid: true, bounceType: 'extension' };
    }
    if (trimmed === 'all') {
        return { valid: true, bounceType: 'all' };
    }
    return { valid: false, error: `Unknown bounce type: ${trimmed}` };
}
function processBounceFile(filePath, onBounce, onError) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseBounceFile(content);
        if (!parsed.valid) {
            if (onError) {
                onError(parsed.error || 'Unknown error');
            }
        }
        else if (parsed.bounceType) {
            onBounce(parsed.bounceType);
        }
        // Delete the file after processing (whether valid or invalid)
        fs.unlinkSync(filePath);
    }
    catch (error) {
        if (onError) {
            const message = error instanceof Error ? error.message : String(error);
            onError(`Failed to process bounce file: ${message}`);
        }
    }
}
function startBounceWatcher(targetPath, onBounce, onError) {
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    const bounceFilePath = path.join(swarmforgeDir, 'bounce');
    // Check if directory exists
    if (!fs.existsSync(swarmforgeDir)) {
        return null;
    }
    // Watch the directory since watching a non-existent file may not work reliably
    const watcher = fs.watch(swarmforgeDir, (eventType, filename) => {
        if (filename !== 'bounce') {
            return;
        }
        // Small delay to ensure file is fully written
        setTimeout(() => {
            if (fs.existsSync(bounceFilePath)) {
                processBounceFile(bounceFilePath, onBounce, onError);
            }
        }, 50);
    });
    return watcher;
}
//# sourceMappingURL=bounceWatcher.js.map