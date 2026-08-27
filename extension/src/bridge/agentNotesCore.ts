import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseRolesTsv } from '../swarm/swarmState';

const execFileAsync = promisify(execFile);

export const AGENT_NOTE_MESSAGE_MAX_LEN = 80;
export const AGENT_NOTE_OPERATOR_PREFIX = 'Bubble: ';
export const AGENT_NOTE_USER_MESSAGE_MAX_LEN = AGENT_NOTE_MESSAGE_MAX_LEN - AGENT_NOTE_OPERATOR_PREFIX.length;

export type AgentNoteRequest = { role: string; message: string };

export type AgentNoteValidationFailure = { ok: false; reason: string };
export type AgentNoteValidationSuccess = { ok: true; queuedMessage: string };
export type AgentNoteValidationResult = AgentNoteValidationFailure | AgentNoteValidationSuccess;

export function isAgentNoteRequestShape(value: unknown): value is AgentNoteRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).role === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

export function composeAgentNoteMessage(userMessage: string): string {
  return `${AGENT_NOTE_OPERATOR_PREFIX}${userMessage}`;
}

export function isOperatorAttributedAgentNote(message: string): boolean {
  return message.startsWith(AGENT_NOTE_OPERATOR_PREFIX);
}

export function readDeclaredRoleNames(targetPath: string): string[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  try {
    return parseRolesTsv(fs.readFileSync(rolesFile, 'utf8')).map((entry) => entry.role);
  } catch {
    return [];
  }
}

function hasForbiddenLineOrControl(message: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(message) || message.includes('\n') || message.includes('\r');
}

export function validateAgentNoteUserMessage(message: string): AgentNoteValidationResult {
  if (message.length === 0) {
    return { ok: false, reason: 'that a note needs a message' };
  }
  if (hasForbiddenLineOrControl(message)) {
    return { ok: false, reason: 'the single-line requirement' };
  }
  const queuedMessage = composeAgentNoteMessage(message);
  if (queuedMessage.length > AGENT_NOTE_MESSAGE_MAX_LEN) {
    return { ok: false, reason: 'the one-line character limit' };
  }
  return { ok: true, queuedMessage };
}

export function validateAgentNoteRole(
  role: string,
  declaredRoles: string[]
): { ok: true } | { ok: false; reason: string } {
  if (!declaredRoles.includes(role)) {
    return { ok: false, reason: 'that the role is not declared' };
  }
  return { ok: true };
}

export type QueueAgentNoteResult = { ok: true } | { ok: false; reason: string };

export type QueueAgentNoteExec = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

function defaultQueueExec(
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, options);
}

export async function queueAgentNoteViaHandoff(
  targetPath: string,
  role: string,
  queuedMessage: string,
  exec: QueueAgentNoteExec = defaultQueueExec
): Promise<QueueAgentNoteResult> {
  const draftDir = path.join(targetPath, 'tmp');
  fs.mkdirSync(draftDir, { recursive: true });
  const draftPath = path.join(
    draftDir,
    `agent-note-draft-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );
  fs.writeFileSync(draftPath, `type: note\nto: ${role}\npriority: 00\nmessage: ${queuedMessage}\n`);
  const cli = path.join(targetPath, 'swarmforge', 'scripts', 'swarm_handoff.bb');
  try {
    const handoffEnv: NodeJS.ProcessEnv = { ...process.env, SWARMFORGE_ROLE: 'coordinator' };
    delete handoffEnv.GIT_DIR;
    delete handoffEnv.GIT_WORK_TREE;
    await exec('bb', [cli, draftPath], {
      cwd: targetPath,
      env: handoffEnv,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'handoff delivery failed' };
  }
}

export type DecideAgentNoteResult =
  | { success: true; role: string; message: string }
  | { success: false; reason: string };

export async function decideAgentNoteSend(
  targetPath: string,
  request: AgentNoteRequest,
  exec?: QueueAgentNoteExec
): Promise<DecideAgentNoteResult> {
  const roleCheck = validateAgentNoteRole(request.role, readDeclaredRoleNames(targetPath));
  if (!roleCheck.ok) {
    return { success: false, reason: roleCheck.reason };
  }
  const messageCheck = validateAgentNoteUserMessage(request.message);
  if (!messageCheck.ok) {
    return { success: false, reason: messageCheck.reason };
  }
  const queued = await queueAgentNoteViaHandoff(targetPath, request.role, messageCheck.queuedMessage, exec);
  if (!queued.ok) {
    return { success: false, reason: queued.reason };
  }
  return { success: true, role: request.role, message: messageCheck.queuedMessage };
}
