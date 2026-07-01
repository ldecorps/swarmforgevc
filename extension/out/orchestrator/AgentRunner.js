"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRunner = void 0;
const SwarmOrchestrator_1 = require("./SwarmOrchestrator");
class AgentRunner {
    orchestrator;
    roles;
    constructor(roleConfigs) {
        this.orchestrator = new SwarmOrchestrator_1.SwarmOrchestrator();
        this.roles = roleConfigs.map((rc) => ({ role: rc.role, displayName: rc.displayName }));
        for (const rc of roleConfigs) {
            this.orchestrator.add({ role: rc.role, command: rc.command, args: rc.args });
        }
    }
    start() {
        this.orchestrator.start();
    }
    stop() {
        this.orchestrator.stop();
    }
    getOrchestrator() {
        return this.orchestrator;
    }
    getRoles() {
        return this.roles;
    }
}
exports.AgentRunner = AgentRunner;
//# sourceMappingURL=AgentRunner.js.map