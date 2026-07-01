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
exports.writeHeartbeat = writeHeartbeat;
exports.readHeartbeat = readHeartbeat;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const atomicWrite_1 = require("../util/atomicWrite");
function writeHeartbeat(dir, data) {
    const yaml = `role: ${data.role}
pid: ${data.pid}
last_beat: "${data.last_beat}"
last_tool: ${data.last_tool}
phase: ${data.phase}
in_flight: ${data.in_flight}
beat_count: ${data.beat_count}
`;
    const filePath = path.join(dir, `${data.role}.yaml`);
    (0, atomicWrite_1.atomicWrite)(filePath, yaml);
}
function parseYamlLine(line) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m)
        return null;
    const key = m[1];
    let val = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (val === 'true')
        val = true;
    else if (val === 'false')
        val = false;
    else if (/^\d+$/.test(val))
        val = parseInt(val, 10);
    return [key, val];
}
function readHeartbeat(dir, role) {
    const filePath = path.join(dir, `${role}.yaml`);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const obj = {};
        for (const line of content.split('\n')) {
            const parsed = parseYamlLine(line);
            if (parsed)
                obj[parsed[0]] = parsed[1];
        }
        return obj;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=heartbeat.js.map