#!/usr/bin/env node
/**
 * ack-handoff <logPath> <by> [leaseTtlSeconds]
 *
 * Claims a message for <by>. Exits 0 on success, 1 if rejected.
 */
import { claimMessage } from '../swarm/messageBus';

const [, , logPath, by, ttlStr] = process.argv;

if (!logPath || !by) {
  process.stderr.write('Usage: ack-handoff <logPath> <by> [leaseTtlSeconds]\n');
  process.exit(1);
}

const ttl = ttlStr ? parseInt(ttlStr, 10) : 300;
const nowEpoch = Math.floor(Date.now() / 1000);
const ok = claimMessage(logPath, by, nowEpoch, ttl);

if (ok) {
  process.stdout.write(`CLAIMED: ${logPath} by ${by}\n`);
  process.exit(0);
} else {
  process.stderr.write(`REJECTED: ${logPath} — live lease held by another claimer\n`);
  process.exit(1);
}
