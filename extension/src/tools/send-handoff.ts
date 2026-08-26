#!/usr/bin/env node
/**
 * send-handoff <dir> <from> <to> <subject> <body> <seq>
 *
 * Creates a new message in <dir> and prints the message id.
 */
import { createMessage } from '../swarm/messageBus';

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

const id = createMessage(dir, { from, to, subject, body, seq });
process.stdout.write(id + '\n');
