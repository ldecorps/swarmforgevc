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
exports.loadRuns = loadRuns;
exports.appendRun = appendRun;
exports.updateLastRunForTarget = updateLastRunForTarget;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadRuns(logPath) {
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.trim().split('\n');
        return lines
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));
    }
    catch {
        return [];
    }
}
function appendRun(logPath, entry) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
}
function updateLastRunForTarget(logPath, targetPath, update) {
    const runs = loadRuns(logPath);
    for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i].targetPath === targetPath) {
            runs[i] = { ...runs[i], ...update };
            const lines = runs.map((r) => JSON.stringify(r) + '\n').join('');
            fs.writeFileSync(logPath, lines, 'utf8');
            return;
        }
    }
}
//# sourceMappingURL=runLog.js.map