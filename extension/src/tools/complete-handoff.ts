#!/usr/bin/env node
/**
 * complete-handoff <logPath> <by>
 *
 * Marks a message done. Appends a done event.
 */
import { completeMessage } from '../swarm/messageBus';

const [, , logPath, by] = process.argv;

if (!logPath || !by) {
  process.stderr.write('Usage: complete-handoff <logPath> <by>\n');
  process.exit(1);
}

completeMessage(logPath, by);
process.stdout.write(`DONE: ${logPath} by ${by}\n`);
