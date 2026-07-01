"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmOrchestrator = void 0;
const ShellBackend_1 = require("./ShellBackend");
class SwarmOrchestrator {
    configs = [];
    backends = new Map();
    outputHandlers = [];
    exitHandlers = [];
    onOutput(handler) {
        this.outputHandlers.push(handler);
    }
    onAgentExit(handler) {
        this.exitHandlers.push(handler);
    }
    add(config) {
        this.configs.push(config);
    }
    start() {
        for (const cfg of this.configs) {
            const backend = new ShellBackend_1.ShellBackend(cfg.command, cfg.args);
            backend.onData((chunk) => {
                for (const h of this.outputHandlers) {
                    h(cfg.role, chunk);
                }
            });
            backend.onExit((code) => {
                for (const h of this.exitHandlers) {
                    h(cfg.role, code);
                }
            });
            this.backends.set(cfg.role, backend);
        }
    }
    writeToAgent(role, data) {
        this.backends.get(role)?.write(data);
    }
    stop() {
        for (const b of this.backends.values()) {
            b.kill();
        }
    }
    waitAll() {
        const backends = Array.from(this.backends.values());
        if (backends.length === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            let remaining = backends.length;
            const dec = () => {
                remaining -= 1;
                if (remaining === 0) {
                    resolve();
                }
            };
            for (const b of backends) {
                b.onExit(dec);
            }
        });
    }
}
exports.SwarmOrchestrator = SwarmOrchestrator;
//# sourceMappingURL=SwarmOrchestrator.js.map