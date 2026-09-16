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

// The steward's seven scored roles (operator directive, 2026-09-09). The
// coordinator is deliberately excluded - the steward does not track it as a
// role-matrix role at all.
export const SCORED_ROLES: readonly string[] = [
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardender',
  'documenter',
  'QA',
];

export interface RoleMatrixLine {
  provider: string;
  model: string;
  score: string;
  evidence: string;
}

export interface RegistryEntry {
  provider: string;
  model: string;
  status: string;
  cost_class?: string;
}

// Parses the CLI's own line shape (verified 2026-09-10):
// `<provider>/<model> <score> <evidence>`. Evidence may itself contain
// spaces, so only the first two fields are fixed-width.
export function parseRoleMatrixLine(line: string): RoleMatrixLine | null {
  const match = line.match(/^(\S+)\/(\S+) (\S+) (.*)$/);
  if (!match) {
    return null;
  }
  const [, provider, model, score, evidence] = match;
  return { provider, model, score, evidence };
}

export interface ScoringReportRow {
  role: string;
  provider: string;
  model: string;
  score: string;
  plan: string;
  evidence: string;
  certified: boolean;
}

export interface ScoringReportDeps {
  runRoleMatrix: (role: string) => string[];
  readRegistry: () => RegistryEntry[];
  roles?: readonly string[];
}

export function buildScoringReportRows(deps: ScoringReportDeps): ScoringReportRow[] {
  const roles = deps.roles ?? SCORED_ROLES;
  const registryByKey = new Map(deps.readRegistry().map((entry) => [`${entry.provider}/${entry.model}`, entry]));
  const rows: ScoringReportRow[] = [];
  for (const role of roles) {
    for (const line of deps.runRoleMatrix(role)) {
      const parsed = parseRoleMatrixLine(line);
      if (!parsed) {
        continue;
      }
      const entry = registryByKey.get(`${parsed.provider}/${parsed.model}`);
      rows.push({
        role,
        provider: parsed.provider,
        model: parsed.model,
        score: parsed.score,
        plan: entry?.cost_class ?? '',
        evidence: parsed.evidence,
        certified: entry?.status === 'certified',
      });
    }
  }
  return rows;
}

const COORDINATOR_FOOTER =
  'The model steward does not track the coordinator as a role-matrix role.';

export function renderScoringReportMarkdown(rows: ScoringReportRow[]): string {
  const header = '| Role | Model | Score | Provider/plan | Evidence |\n|---|---|---|---|---|';
  const body = rows
    .map((row) => {
      const mark = row.certified ? '*' : '';
      return `| ${row.role} | ${mark}${row.provider}/${row.model} | ${row.score} | ${row.plan} | ${row.evidence} |`;
    })
    .join('\n');
  return `${header}\n${body}\n\n${COORDINATOR_FOOTER}\n`;
}

export function renderScoringReport(deps: ScoringReportDeps): string {
  return renderScoringReportMarkdown(buildScoringReportRows(deps));
}

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

export interface RenderModelScoringReportArgs {
  projectRoot: string;
  outPath?: string;
  send: boolean;
}

const USAGE = 'Usage: render-model-scoring-report.js <project-root> [--out <path>] [--no-send]\n';

export function parseArgs(argv: string[]): RenderModelScoringReportArgs | null {
  const noSendIndex = argv.indexOf('--no-send');
  const send = noSendIndex < 0;
  const withoutNoSend = noSendIndex < 0 ? argv : [...argv.slice(0, noSendIndex), ...argv.slice(noSendIndex + 1)];
  const outIndex = withoutNoSend.indexOf('--out');
  let outPath: string | undefined;
  let positional = withoutNoSend;
  if (outIndex >= 0) {
    outPath = withoutNoSend[outIndex + 1];
    if (outPath === undefined) {
      return null;
    }
    positional = [...withoutNoSend.slice(0, outIndex), ...withoutNoSend.slice(outIndex + 2)];
  }
  const [projectRoot] = positional;
  if (!projectRoot) {
    return null;
  }
  return outPath !== undefined ? { projectRoot, outPath, send } : { projectRoot, send };
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

// The exported, in-process-testable core (scenarios 01-04 drive this
// directly with injected runners/registry/send function - never a real
// shell-out or network call in tests).
export async function renderAndSendReport(
  projectRoot: string,
  args: { outPath?: string; send: boolean },
  deps: RenderAndSendDeps = {}
): Promise<RenderAndSendOutcome> {
  const runRoleMatrix = deps.runRoleMatrix ?? realRunRoleMatrix(projectRoot);
  const readRegistry = deps.readRegistry ?? (() => realReadRegistry(projectRoot));
  const content = renderScoringReport({ runRoleMatrix, readRegistry });
  const outPath = args.outPath ?? path.join(projectRoot, 'tmp', 'model-scoring-report.md');
  const writeFile =
    deps.writeFile ??
    ((filePath: string, fileContent: string) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, fileContent);
    });
  writeFile(outPath, content);
  if (!args.send) {
    return { outPath, sent: false };
  }
  const sendReportDocument = deps.sendReportDocument ?? realSendReportDocument;
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
