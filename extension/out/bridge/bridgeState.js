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
exports.buildBridgeState = buildBridgeState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const swarmState_1 = require("../swarm/swarmState");
const backlogReader_1 = require("../panel/backlogReader");
const heartbeat_1 = require("../tools/heartbeat");
const runLog_1 = require("../runs/runLog");
function readAgents(targetPath) {
    const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
    let tsv;
    try {
        tsv = fs.readFileSync(rolesFile, 'utf8');
    }
    catch {
        return [];
    }
    const roles = (0, swarmState_1.parseRolesTsv)(tsv);
    const statusByRole = new Map((0, swarmState_1.readPipelineStages)(targetPath).map((s) => [s.role, s.status]));
    return roles.map((role) => {
        const agent = {
            role: role.role,
            displayName: role.displayName,
            status: statusByRole.get(role.role) ?? 'idle',
        };
        const heartbeat = (0, heartbeat_1.readHeartbeat)(path.join(role.worktreePath, '.swarmforge', 'heartbeat'), role.role);
        if (heartbeat) {
            agent.heartbeat = heartbeat;
        }
        return agent;
    });
}
function buildBridgeState(targetPath, runLogPath) {
    return {
        pipeline: (0, swarmState_1.readPipelineStages)(targetPath),
        agents: readAgents(targetPath),
        backlog: (0, backlogReader_1.readBacklogFolders)(targetPath),
        runLog: (0, runLog_1.loadRuns)(runLogPath),
    };
}
//# sourceMappingURL=bridgeState.js.map