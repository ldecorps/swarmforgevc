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
import { resolveProjectRoot, resolveMainWorktreePath, loadRoles, runCliMain } from './swarm-metrics';

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);

  const tree = computeDocsTree(mainWorktreePath);
  process.stdout.write(JSON.stringify(tree, null, 2) + '\n');
}

if (require.main === module) {
  runCliMain(main);
}
