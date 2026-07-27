// BL-696: shared Cursor bridge agent session for Let's Talk and the
// Telegram Cursor Remote topic. One agentId in cursor-bridge-state.json;
// a file lock serializes writers across processes.

import * as fs from 'fs';
import * as path from 'path';
import { Agent, CursorAgentError, type SDKAgent, type SDKMessage } from '@cursor/sdk';
import { atomicWrite } from '../util/atomicWrite';
import { collectAssistantTextFromMessages, parseCursorBridgeState, type CursorBridgePersistedState } from '../tools/telegramCursorBridgeCore';
import { extractCodeWordFromRememberPhrase, mockAgentReplyForTranscript } from './letsTalkCore';

const STATE_FILE_NAME = 'cursor-bridge-state.json';
const LOCK_FILE_NAME = 'cursor-bridge-agent.lock';
const LOCK_STALE_MS = 5 * 60 * 1000;

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

async function acquireAgentLock(targetPath: string): Promise<() => void> {
  const lockPath = lockPathOf(targetPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
      if (isStaleLock(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // contested stale removal — retry
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
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

function agentOptions(repoRoot: string, apiKey: string | undefined, modelId: string) {
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
    return Agent.resume(agentId, agentOptions(repoRoot, apiKey, modelId));
  }
  return Agent.create(agentOptions(repoRoot, apiKey, modelId));
}

async function runPrompt(agent: SDKAgent, prompt: string): Promise<string> {
  const run = await agent.send(prompt);
  const messages: SDKMessage[] = [];
  for await (const event of run.stream()) {
    messages.push(event);
  }
  const result = await run.wait();
  if (result.status === 'error') {
    const detail = result.error?.message ?? 'unknown error';
    throw new Error(`Cursor run failed (${result.id}): ${detail}`);
  }
  const text = collectAssistantTextFromMessages(messages).trim();
  return text.length > 0 ? text : '(no text reply)';
}

export function createLiveCursorBridgeAgentSession(targetPath: string): CursorBridgeAgentSessionDeps {
  const apiKey = process.env.CURSOR_API_KEY;
  const modelId = process.env.CURSOR_BRIDGE_MODEL ?? 'auto';
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

  return {
    readAgentId: () => loadState(targetPath).agentId,
    resetSession: async () =>
      withAgentLock(targetPath, async () => {
        if (cachedAgent) {
          await cachedAgent.close();
          cachedAgent = undefined;
        }
        const state = loadState(targetPath);
        const next = { ...state, agentId: undefined };
        saveState(targetPath, next);
        return { agentId: undefined };
      }),
    promptAgent: async (prompt: string) =>
      withAgentLock(targetPath, async () => {
        try {
          const agent = await ensureAgent();
          const replyText = await runPrompt(agent, prompt);
          const state = loadState(targetPath);
          saveState(targetPath, { ...state, agentId: agent.agentId });
          return { replyText, agentId: agent.agentId };
        } catch (err) {
          const detail = err instanceof CursorAgentError ? err.message : err instanceof Error ? err.message : String(err);
          throw new Error(detail);
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
