#!/usr/bin/env node
/**
 * BL-150: generates recert-batch.json for the phone PWA's recertification
 * view - the oldest-reviewed-first scenario(s), already resolved.
 *
 * Usage: node generate-recert-batch.js > recert-batch.json
 *
 * Thin presenter over computeRecertBatch (docs/recertificationStore.ts) -
 * no derivation logic here, same posture as generate-docs-tree.js. Prints
 * ONLY the JSON payload to stdout so the Action can redirect it to a file.
 */

import { computeRecertBatch } from '../docs/recertificationStore';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const batch = computeRecertBatch(mainWorktreePath);
  printJsonToStdout(batch);
}

if (require.main === module) {
  runCliMain(main);
}
