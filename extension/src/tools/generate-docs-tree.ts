#!/usr/bin/env node
/**
 * BL-117: generates docs-tree.json for the PWA's documentation explorer.
 *
 * Usage: node generate-docs-tree.js > docs-tree.json
 *
 * Thin presenter over computeDocsTree (docs/docsTree.ts) - no derivation
 * logic here, same posture as generate-backlog-dashboard.js. Prints ONLY
 * the JSON payload to stdout so the Action can redirect it straight to a
 * file.
 */

import { computeDocsTree } from '../docs/docsTree';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const tree = computeDocsTree(mainWorktreePath);
  printJsonToStdout(tree);
}

if (require.main === module) {
  runCliMain(main);
}
