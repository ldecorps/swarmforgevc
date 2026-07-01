"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellBackend = void 0;
const child_process_1 = require("child_process");
class ShellBackend {
    proc;
    dataHandlers = [];
    exitHandlers = [];
    constructor(command, args) {
        this.proc = (0, child_process_1.spawn)(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.stdout?.on('data', (buf) => {
            const text = buf.toString();
            for (const h of this.dataHandlers) {
                h(text);
            }
        });
        this.proc.stderr?.on('data', (buf) => {
            const text = buf.toString();
            for (const h of this.dataHandlers) {
                h(text);
            }
        });
        this.proc.on('close', (code) => {
            for (const h of this.exitHandlers) {
                h(code);
            }
        });
    }
    onData(handler) {
        this.dataHandlers.push(handler);
    }
    onExit(handler) {
        this.exitHandlers.push(handler);
    }
    write(data) {
        this.proc.stdin?.write(data);
    }
    kill() {
        this.proc.kill();
    }
}
exports.ShellBackend = ShellBackend;
//# sourceMappingURL=ShellBackend.js.map