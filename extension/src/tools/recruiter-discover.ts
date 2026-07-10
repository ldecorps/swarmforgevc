#!/usr/bin/env node
/**
 * BL-233 slice 1 (discover-candidates-01): the recruiter's discovery entry
 * point. Out-of-band tooling, same posture as BL-231's compliance battery -
 * no worktree/mailbox/pipeline role, no live swarm state touched. Reads an
 * operator-maintained candidates file and prints the discovered candidate
 * report (model, provider, plan cost, signup path) as JSON to stdout.
 *
 * Usage: node recruiter-discover.js <candidates-file>
 *
 * Thin presenter over discoverySource.ts - no derivation logic here, same
 * posture as generate-backlog-dashboard.ts.
 */

import { createFileDiscoverySource } from '../recruiter/discoverySource';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export async function main(): Promise<void> {
  const candidatesFile = process.argv[2];
  if (!candidatesFile) {
    process.stderr.write('Usage: recruiter-discover.js <candidates-file>\n');
    process.exitCode = 1;
    return;
  }
  const source = createFileDiscoverySource(candidatesFile);
  const candidates = await source.discover();
  printJsonToStdout({ candidates });
}

if (require.main === module) {
  runCliMain(main);
}
