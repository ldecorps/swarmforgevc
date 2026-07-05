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
exports.hasPriorRunState = hasPriorRunState;
exports.shouldOfferResumePrompt = shouldOfferResumePrompt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// BL-066: reinterpreted for the actual built architecture (drives real
// SwarmForge over tmux, per the constitution — not the Specification.MD
// "standalone orchestrator" model this ticket was originally written
// against). tmux sessions already run independent of the extension host —
// there is no child process to detach. The real gap is host-side discovery
// on relaunch: is a swarm already live (re-attach, no restart), or is there
// evidence of a past run with nothing live right now (offer resume instead
// of a silent no-op or a surprise cold start)?
// Written once by the ./swarm launcher on first successful launch for a
// target; its presence means SwarmForge has been run here before, even if
// nothing is live right now.
function hasPriorRunState(targetPath) {
    return fs.existsSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'));
}
// BL-086: startup activation (onStartupFinished) must attach silently or do
// nothing — a "previous run found, resume?" popup on every editor open would
// nag any target with prior run state. The prompt remains available when
// activation was not triggered by startup (e.g. a command wins the
// activation race before onStartupFinished fires), matching pre-BL-086
// behavior on that path.
function shouldOfferResumePrompt(triggeredByStartup, hasPriorRun) {
    return !triggeredByStartup && hasPriorRun;
}
//# sourceMappingURL=swarmDiscovery.js.map