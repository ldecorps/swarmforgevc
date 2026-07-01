#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * complete-handoff <logPath> <by>
 *
 * Marks a message done. Appends a done event.
 */
const messageBus_1 = require("../swarm/messageBus");
const [, , logPath, by] = process.argv;
if (!logPath || !by) {
    process.stderr.write('Usage: complete-handoff <logPath> <by>\n');
    process.exit(1);
}
(0, messageBus_1.completeMessage)(logPath, by);
process.stdout.write(`DONE: ${logPath} by ${by}\n`);
//# sourceMappingURL=complete-handoff.js.map