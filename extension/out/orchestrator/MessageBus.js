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
exports.MessageBus = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
class MessageBus {
    dir;
    constructor(targetPath) {
        this.dir = path.join(targetPath, '.swarmforge', 'messages');
        fs.mkdirSync(this.dir, { recursive: true });
    }
    write(msg) {
        const id = crypto.randomUUID();
        const full = { id, ...msg };
        const file = path.join(this.dir, `${id}.json`);
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(full));
        fs.renameSync(tmp, file);
        return id;
    }
    readFor(recipient) {
        return this.readAll().filter((m) => m.to === recipient && m.status === 'pending');
    }
    ack(id) {
        const file = path.join(this.dir, `${id}.json`);
        if (!fs.existsSync(file)) {
            return;
        }
        const msg = JSON.parse(fs.readFileSync(file, 'utf8'));
        msg.status = 'done';
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(msg));
        fs.renameSync(tmp, file);
    }
    readAll() {
        const msgs = [];
        for (const f of fs.readdirSync(this.dir)) {
            if (!f.endsWith('.json')) {
                continue;
            }
            try {
                const content = fs.readFileSync(path.join(this.dir, f), 'utf8');
                msgs.push(JSON.parse(content));
            }
            catch {
                // skip corrupt files
            }
        }
        return msgs;
    }
}
exports.MessageBus = MessageBus;
//# sourceMappingURL=MessageBus.js.map