#!/usr/bin/env node
/**
 * BL-117: generates docs-tree.json for the PWA's documentation explorer.
 * BL-118: also runs the FR translation pass (docs/i18n/translation-cache.json
 * committed back to the repo by the workflow, never re-translating an
 * unchanged string) and folds the *Fr fields into the same artifact.
 *
 * Usage: node generate-docs-tree.js > docs-tree.json
 *
 * Thin presenter over computeDocsTree/translateDocsTree (docs/docsTree.ts) -
 * no derivation logic here, same posture as generate-backlog-dashboard.js.
 * Prints ONLY the JSON payload to stdout so the Action can redirect it
 * straight to a file.
 */

import { computeDocsTree, translateDocsTree } from '../docs/docsTree';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { createCliTranslationSession, persistCliTranslationSession } from '../i18n/cliSession';

export async function main(): Promise<void> {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const tree = computeDocsTree(mainWorktreePath);
  const session = createCliTranslationSession(mainWorktreePath);
  const translated = await translateDocsTree(tree, session);
  persistCliTranslationSession(mainWorktreePath, session);
  printJsonToStdout(translated);
}

if (require.main === module) {
  runCliMain(main);
}
