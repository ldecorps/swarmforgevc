#!/usr/bin/env node
/**
 * BL-1510: headless renderer that pulls the model steward's role-matrix for
 * each of the seven scored roles, joins it with the registry's certified
 * set, writes one table file, and delivers it to the Concierge topic
 * through BL-1509's sendDocument (the mechanism's first live consumer).
 *
 * Usage: node render-model-scoring-report.js <project-root> [--out <path>] [--no-send]
 *
 * Re-pulls the steward at render time (never a copy of a hand-made table):
 * `bb swarmforge/scripts/model_steward_cli.bb role-matrix <role>
 * --include-uncertified` per scored role, and the registry JSON the steward
 * CLI itself reads for the certified mark.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { sendDocument } from '../notify/telegramClient';
import { printJsonToStdout, runCliMain, makeArgsGuardedMain } from './swarm-metrics';
import { readTopicMap } from './telegram-front-desk-bot';
import { topicForSubject, OPERATOR_SUBJECT_ID } from './telegramFrontDeskBotCore';
import {
  SCORED_ROLES,
  RoleMatrixLine,
  RegistryEntry,
  parseRoleMatrixLine,
  ScoringReportRow,
  ScoringReportDeps,
  buildScoringReportRows,
  renderScoringReportMarkdown,
  renderScoringReport,
} from './model-scoring-report-core';
import { RenderModelScoringReportArgs, USAGE, parseArgs } from './renderModelScoringReportArgs';

// Domain logic (parsing, joining, rendering) lives in
// model-scoring-report-core.ts; CLI flag parsing lives in
// renderModelScoringReportArgs.ts. Both are re-exported here so existing
// callers keep importing everything from this one file (the wiring anchor
// pins sendDocument to this path, and tests/step handlers import the
// domain symbols alongside it).
export {
  SCORED_ROLES,
  RoleMatrixLine,
  RegistryEntry,
  parseRoleMatrixLine,
  ScoringReportRow,
  ScoringReportDeps,
  buildScoringReportRows,
  renderScoringReportMarkdown,
  renderScoringReport,
  RenderModelScoringReportArgs,
  parseArgs,
};

// Real runners - shell to the steward CLI / read the registry JSON it
// itself reads, never parse the certified mark out of prose.
function realRunRoleMatrix(projectRoot: string): (role: string) => string[] {
  return (role: string): string[] => {
    const cliPath = path.join(projectRoot, 'swarmforge', 'scripts', 'model_steward_cli.bb');
    const out = execFileSync('bb', [cliPath, 'role-matrix', role, '--include-uncertified'], {
      encoding: 'utf8',
      cwd: projectRoot,
    });
    return out.split('\n').filter((line) => line.trim().length > 0);
  };
}

function realReadRegistry(projectRoot: string): RegistryEntry[] {
  const registryPath = path.join(projectRoot, '.swarmforge', 'model-steward', 'registry.json');
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  const data = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as { models?: Record<string, RegistryEntry> };
  return Object.values(data.models ?? {});
}

export interface RenderAndSendOutcome {
  outPath: string;
  sent: boolean;
  reason?: string;
}

export interface RenderAndSendDeps {
  runRoleMatrix?: (role: string) => string[];
  readRegistry?: () => RegistryEntry[];
  writeFile?: (filePath: string, content: string) => void;
  sendReportDocument?: (projectRoot: string, filePath: string, content: string) => Promise<{ success: boolean; reason?: string }>;
}

interface ResolvedRenderAndSendDeps {
  runRoleMatrix: (role: string) => string[];
  readRegistry: () => RegistryEntry[];
  writeFile: (filePath: string, content: string) => void;
  sendReportDocument: (projectRoot: string, filePath: string, content: string) => Promise<{ success: boolean; reason?: string }>;
}

function defaultWriteFile(filePath: string, fileContent: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, fileContent);
}

// Split out of renderAndSendReport (cleaner-domain-shaped, done here per the
// CRAP rule: renderAndSendReport's own default-resolution branches pushed
// its complexity to 8, over the CRAP=6 threshold even at 100% coverage -
// complexity alone drives CRAP when coverage is full). Isolating the four
// `??` fallbacks here keeps each function's own complexity under the cap.
function resolveRenderAndSendDeps(projectRoot: string, deps: RenderAndSendDeps): ResolvedRenderAndSendDeps {
  return {
    runRoleMatrix: deps.runRoleMatrix ?? realRunRoleMatrix(projectRoot),
    readRegistry: deps.readRegistry ?? (() => realReadRegistry(projectRoot)),
    writeFile: deps.writeFile ?? defaultWriteFile,
    sendReportDocument: deps.sendReportDocument ?? realSendReportDocument,
  };
}

// The exported, in-process-testable core (scenarios 01-04 drive this
// directly with injected runners/registry/send function - never a real
// shell-out or network call in tests).
export async function renderAndSendReport(
  projectRoot: string,
  args: { outPath?: string; send: boolean },
  deps: RenderAndSendDeps = {}
): Promise<RenderAndSendOutcome> {
  const { runRoleMatrix, readRegistry, writeFile, sendReportDocument } = resolveRenderAndSendDeps(projectRoot, deps);
  const content = renderScoringReport({ runRoleMatrix, readRegistry });
  const outPath = args.outPath ?? path.join(projectRoot, 'tmp', 'model-scoring-report.md');
  writeFile(outPath, content);
  if (!args.send) {
    return { outPath, sent: false };
  }
  const result = await sendReportDocument(projectRoot, outPath, content);
  return result.success ? { outPath, sent: true } : { outPath, sent: false, reason: result.reason };
}

async function realSendReportDocument(
  projectRoot: string,
  filePath: string,
  content: string
): Promise<{ success: boolean; reason?: string }> {
  const topicId = topicForSubject(readTopicMap(projectRoot), OPERATOR_SUBJECT_ID);
  if (topicId === undefined) {
    return { success: false, reason: 'operator-topic-not-yet-created' };
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { success: false, reason: 'missing-telegram-config' };
  }
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  const result = forced
    ? JSON.parse(forced)
    : await sendDocument(token, chatId, Buffer.from(content), path.basename(filePath), topicId, undefined);
  return result.success ? { success: true } : { success: false, reason: result.error };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const outcome = await renderAndSendReport(args.projectRoot, { outPath: args.outPath, send: args.send });
  printJsonToStdout(outcome);
  if (args.send && !outcome.sent) {
    process.exitCode = 1;
  }
});

if (require.main === module) {
  runCliMain(main);
}
