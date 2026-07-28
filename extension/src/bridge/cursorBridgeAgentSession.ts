// BL-696: shared Cursor bridge agent session for Let's Talk and the
// Telegram Cursor Remote topic. One agentId in cursor-bridge-state.json;
// a file lock serializes writers across processes.

import * as fs from 'fs';
import * as path from 'path';
import { Agent, CursorAgentError, type SDKAgent, type SDKMessage } from '@cursor/sdk';
import { atomicWrite } from '../util/atomicWrite';
import { collectAssistantTextFromMessages, isActiveRunConflict, parseCursorBridgeState, type CursorBridgePersistedState } from '../tools/telegramCursorBridgeCore';
import { extractCodeWordFromRememberPhrase, mockAgentReplyForTranscript } from './letsTalkCore';
import { readSwarmEnvValue } from '../tools/swarmEnv';
import type { CursorAgentProgressCallback } from './cursorBridgeProgress';
import { summarizeSdkProgressLine } from './cursorBridgeProgress';

const MISSING_CURSOR_API_KEY_MESSAGE =
  'CURSOR_API_KEY is not set for the headless bridge. Add `export CURSOR_API_KEY=...` to .swarmforge/swarm.env and restart the bridge supervisor. The Cursor IDE login session is not passed to telegram/headless bridge processes.';

const STATE_FILE_NAME = 'cursor-bridge-state.json';
const LOCK_FILE_NAME = 'cursor-bridge-agent.lock';
const LOCK_STALE_MS = 5 * 60 * 1000;
const LOCK_POLL_MS = 25;
const LOCK_MAX_WAIT_MS = 10 * 60 * 1000;

export type PromptCursorAgent = (prompt: string) => Promise<{ replyText: string; agentId: string }>;
export type ResetCursorAgentSession = () => Promise<{ agentId: string | undefined }>;
export type ReadCursorAgentId = () => string | undefined;

export interface CursorBridgeAgentSessionDeps {
  promptAgent: PromptCursorAgent;
  resetSession: ResetCursorAgentSession;
  readAgentId: ReadCursorAgentId;
}

function statePathOf(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', STATE_FILE_NAME);
}

function lockPathOf(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', LOCK_FILE_NAME);
}

function loadState(targetPath: string): CursorBridgePersistedState {
  const filePath = statePathOf(targetPath);
  if (!fs.existsSync(filePath)) {
    return { updateOffset: 0 };
  }
  return parseCursorBridgeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function saveState(targetPath: string, state: CursorBridgePersistedState): void {
  fs.mkdirSync(path.dirname(statePathOf(targetPath)), { recursive: true });
  atomicWrite(statePathOf(targetPath), `${JSON.stringify(state, null, 2)}\n`);
}

function isStaleLock(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function readLockHolderPid(lockPath: string): number | undefined {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Lock file is stale by age, unreadable, or held by a process that no longer exists. */
export function isAbandonedAgentLock(lockPath: string): boolean {
  if (isStaleLock(lockPath)) {
    return true;
  }
  const pid = readLockHolderPid(lockPath);
  if (pid === undefined) {
    return true;
  }
  return !isProcessAlive(pid);
}

function shouldClearContestedLock(lockPath: string): boolean {
  return isAbandonedAgentLock(lockPath);
}

async function acquireAgentLock(targetPath: string): Promise<() => void> {
  const lockPath = lockPathOf(targetPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const maxAttempts = Math.ceil(LOCK_MAX_WAIT_MS / LOCK_POLL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx' });
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // best effort
        }
      };
    } catch {
      if (shouldClearContestedLock(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // contested stale removal — retry
        }
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  throw new Error('cursor bridge agent lock timeout');
}

export async function withAgentLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireAgentLock(targetPath);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function resolveCursorApiKey(repoRoot: string): string {
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromSwarmEnv = readSwarmEnvValue(repoRoot, 'CURSOR_API_KEY');
  if (fromSwarmEnv) {
    return fromSwarmEnv;
  }
  throw new Error(MISSING_CURSOR_API_KEY_MESSAGE);
}

export function buildAgentOptions(repoRoot: string, apiKey: string | undefined, modelId: string) {
  return {
    ...(apiKey ? { apiKey } : {}),
    model: { id: modelId },
    local: { cwd: repoRoot, settingSources: [] },
  };
}

async function openAgent(
  repoRoot: string,
  apiKey: string | undefined,
  modelId: string,
  agentId: string | undefined
): Promise<SDKAgent> {
  if (agentId) {
    return Agent.resume(agentId, buildAgentOptions(repoRoot, apiKey, modelId));
  }
  return Agent.create(buildAgentOptions(repoRoot, apiKey, modelId));
}

let activePromptProgress: CursorAgentProgressCallback | undefined;

export function withPromptProgress<T>(onProgress: CursorAgentProgressCallback | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = activePromptProgress;
  activePromptProgress = onProgress;
  return fn().finally(() => {
    activePromptProgress = previous;
  });
}

async function reportSdkProgress(event: SDKMessage, onProgress: CursorAgentProgressCallback | undefined): Promise<void> {
  if (!onProgress) {
    return;
  }
  const line = summarizeSdkProgressLine(event);
  if (line) {
    await onProgress(line);
  }
}

function assertCursorRunSucceeded(result: Awaited<ReturnType<Awaited<ReturnType<SDKAgent['send']>>['wait']>>): void {
  if (result.status === 'error') {
    const detail = result.error?.message ?? 'unknown error';
    throw new Error(`Cursor run failed (${result.id}): ${detail}`);
  }
}

function assistantReplyOrPlaceholder(messages: SDKMessage[]): string {
  const text = collectAssistantTextFromMessages(messages).trim();
  return text.length > 0 ? text : '(no text reply)';
}

export async function runCursorAgentPrompt(
  agent: SDKAgent,
  prompt: string,
  onProgress: CursorAgentProgressCallback | undefined = activePromptProgress
): Promise<string> {
  const run = await agent.send(prompt);
  const messages: SDKMessage[] = [];
  for await (const event of run.stream()) {
    messages.push(event);
    await reportSdkProgress(event, onProgress);
  }
  const result = await run.wait();
  assertCursorRunSucceeded(result);
  return assistantReplyOrPlaceholder(messages);
}

export function createLiveCursorBridgeAgentSession(targetPath: string): CursorBridgeAgentSessionDeps {
  const apiKey = resolveCursorApiKey(targetPath);
  const modelId = process.env.CURSOR_BRIDGE_MODEL?.trim() || readSwarmEnvValue(targetPath, 'CURSOR_BRIDGE_MODEL') || 'auto-smart';
  let cachedAgent: SDKAgent | undefined;

  const ensureAgent = async (): Promise<SDKAgent> => {
    const state = loadState(targetPath);
    if (!cachedAgent) {
      cachedAgent = await openAgent(targetPath, apiKey, modelId, state.agentId);
      const next = { ...state, agentId: cachedAgent.agentId };
      saveState(targetPath, next);
    }
    return cachedAgent;
  };

  const clearCachedAgent = async (): Promise<void> => {
    if (cachedAgent) {
      await cachedAgent.close();
      cachedAgent = undefined;
    }
    const state = loadState(targetPath);
    saveState(targetPath, { ...state, agentId: undefined });
  };

  return {
    readAgentId: () => loadState(targetPath).agentId,
    resetSession: async () =>
      withAgentLock(targetPath, async () => {
        await clearCachedAgent();
        return { agentId: undefined };
      }),
    promptAgent: async (prompt: string) =>
      withAgentLock(targetPath, async () => {
        const attempt = async (): Promise<{ replyText: string; agentId: string }> => {
          const agent = await ensureAgent();
          const replyText = await runCursorAgentPrompt(agent, prompt);
          const state = loadState(targetPath);
          saveState(targetPath, { ...state, agentId: agent.agentId });
          return { replyText, agentId: agent.agentId };
        };
        try {
          return await attempt();
        } catch (err) {
          const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
          if (!isActiveRunConflict(detail)) {
            throw new Error(detail);
          }
          await clearCachedAgent();
          return await attempt();
        }
      }),
  };
}

export function createMockCursorBridgeAgentSession(targetPath: string): CursorBridgeAgentSessionDeps & { rememberedCodeWord: () => string | undefined } {
  let agentId = 'mock-agent-1';
  let remembered: string | undefined;

  return {
    rememberedCodeWord: () => remembered,
    readAgentId: () => agentId,
    resetSession: async () => {
      remembered = undefined;
      agentId = `mock-agent-${Date.now()}`;
      const state = loadState(targetPath);
      saveState(targetPath, { ...state, agentId });
      return { agentId };
    },
    promptAgent: async (prompt: string) => {
      const replyText = mockAgentReplyForTranscript(prompt, remembered);
      const extracted = extractCodeWordFromRememberPhrase(prompt);
      if (extracted) {
        remembered = extracted;
      }
      const state = loadState(targetPath);
      saveState(targetPath, { ...state, agentId });
      return { replyText, agentId };
    },
  };
}
