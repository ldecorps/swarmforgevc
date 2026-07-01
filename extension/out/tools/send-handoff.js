#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * send-handoff <dir> <from> <to> <subject> <body> <seq>
 *
 * Creates a new message in <dir> and prints the message id.
 */
const messageBus_1 = require("../swarm/messageBus");
const [, , dir, from, to, subject, body, seqStr] = process.argv;
if (!dir || !from || !to || !subject || body === undefined || !seqStr) {
    process.stderr.write('Usage: send-handoff <dir> <from> <to> <subject> <body> <seq>\n');
    process.exit(1);
}
const seq = parseInt(seqStr, 10);
if (isNaN(seq)) {
    process.stderr.write(`seq must be an integer, got: ${seqStr}\n`);
    process.exit(1);
}
const id = (0, messageBus_1.createMessage)(dir, { from, to, subject, body, seq });
process.stdout.write(id + '\n');
//# sourceMappingURL=send-handoff.js.map