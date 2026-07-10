#!/usr/bin/env node
/**
 * BL-097: generates backlog.json for the Pages-hosted PWA dashboard.
 * BL-118/BL-230: also runs the translation pass over every board ticket's
 * title into each configured target locale (docs/i18n/translation-cache.json
 * committed back to the repo by the workflow, never re-translating an
 * unchanged string) and folds titleTranslations (keyed by locale code) into
 * the same artifact.
 *
 * Usage: node generate-backlog-dashboard.js > backlog.json
 *
 * Thin presenter over computeBacklogDashboard/translateBacklogDashboard
 * (metrics/backlogDashboard.ts) - no derivation logic here, matching this
 * ticket's own non-behavioral gate ("the workflow YAML holds no logic
 * beyond invoking it and publishing"). Prints ONLY the JSON payload to
 * stdout so the GitHub Action can redirect it straight to a file.
 */

import { computeBacklogDashboard, translateBacklogDashboard } from '../metrics/backlogDashboard';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { createCliTranslationSession, persistCliTranslationSession } from '../i18n/cliSession';

export async function main(): Promise<void> {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const dashboard = computeBacklogDashboard(mainWorktreePath, roleWorktrees);
  const session = createCliTranslationSession(mainWorktreePath);
  const translated = await translateBacklogDashboard(dashboard, session);
  persistCliTranslationSession(mainWorktreePath, session);
  printJsonToStdout(translated);
}

if (require.main === module) {
  runCliMain(main);
}
