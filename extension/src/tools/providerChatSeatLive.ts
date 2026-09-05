/**
 * Live I/O for providerChatSeat.ts — read the topic→seat map, call an
 * OpenAI-compatible chat completions endpoint, post back into the topic.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PROVIDER_CHAT_TOPIC_MAP_REL,
  ProviderChatSeatConfig,
  decideProviderChatTurn,
  formatProviderChatAcknowledgement,
  formatProviderChatRefusal,
} from './providerChatSeat';

export function providerChatTopicMapPath(targetPath: string): string {
  return path.join(targetPath, ...PROVIDER_CHAT_TOPIC_MAP_REL);
}

function parseSeat(raw: unknown): ProviderChatSeatConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const model = String(o.model ?? '').trim();
  const baseUrl = String(o.baseUrl ?? '').trim();
  const apiKeyEnv = String(o.apiKeyEnv ?? '').trim();
  if (!model || !baseUrl || !apiKeyEnv) {
    return undefined;
  }
  const systemPrompt = typeof o.systemPrompt === 'string' && o.systemPrompt.trim() ? o.systemPrompt : undefined;
  return { model, baseUrl, apiKeyEnv, systemPrompt };
}

export function readProviderChatTopicSeats(targetPath: string): Record<string, ProviderChatSeatConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(providerChatTopicMapPath(targetPath), 'utf8')) as Record<
      string,
      unknown
    >;
    const out: Record<string, ProviderChatSeatConfig> = {};
    for (const [topicId, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(topicId)) {
        continue;
      }
      const seat = parseSeat(value);
      if (seat) {
        out[topicId] = seat;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Cheap, best-effort live grounding — plain fs reads, never a shell-out, and
// never throws (a snapshot failure degrades to fewer facts, not a broken
// reply). This is what stands in for real tool access: the MODEL never
// decides to fetch anything, this composes a short factual block server-side
// and sends it as part of the system message on every turn.
function readSwarmIdentity(targetPath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(targetPath, '.swarmforge', 'swarm-identity'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      out[line.slice(0, tab)] = line.slice(tab + 1);
    }
    return out;
  } catch {
    return {};
  }
}

function countBacklogYaml(targetPath: string, folder: string): number | undefined {
  try {
    return fs.readdirSync(path.join(targetPath, 'backlog', folder)).filter((f) => f.endsWith('.yaml')).length;
  } catch {
    return undefined;
  }
}

export function composeSwarmContextBlock(targetPath: string, nowIso: string = new Date().toISOString()): string {
  const identity = readSwarmIdentity(targetPath);
  const active = countBacklogYaml(targetPath, 'active');
  const paused = countBacklogYaml(targetPath, 'paused');
  const lines = [
    `Live snapshot (${nowIso}), read directly from disk, not from you:`,
    `- launch pack: ${identity.launch_pack || 'unknown'}${identity.rotation ? ` (rotation: ${identity.rotation})` : ''}`,
    `- active backlog depth cap: ${identity.active_backlog_max_depth ?? 'unknown'}`,
    `- tickets in backlog/active: ${active ?? 'unknown'}, paused: ${paused ?? 'unknown'}`,
    `This snapshot can be stale by the time you answer and covers only these facts - say so plainly rather than inventing anything beyond it.`,
  ];
  return lines.join('\n');
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** DeepSeek accepts both /chat/completions and /v1/chat/completions; NVIDIA NIM wants /v1. */
export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  // An endpoint already naming the path is used as given; everything else -
  // a bare root like https://api.deepseek.com or one ending /v1 like NVIDIA
  // NIM's - gets /chat/completions appended, which is the same suffix in
  // both cases, so they are one branch rather than two identical ones.
  return /\/chat\/completions$/i.test(root) ? root : `${root}/chat/completions`;
}

export async function completeWithProviderChat(
  modelId: string,
  prompt: string,
  baseUrl: string,
  apiKey: string,
  systemPrompt?: string,
  fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike
): Promise<string> {
  const url = chatCompletionsUrl(baseUrl);
  const messages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status}: ${raw.trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return String(parsed.choices?.[0]?.message?.content ?? '').trim();
}

export interface ProviderChatSeatTurnDeps {
  targetPath: string;
  topicId: number | undefined;
  text: string;
  env?: Record<string, string | undefined>;
  post: (topicId: number, message: string) => Promise<void>;
  complete?: (
    modelId: string,
    prompt: string,
    baseUrl: string,
    apiKey: string,
    systemPrompt?: string
  ) => Promise<string>;
  topicSeats?: Record<string, ProviderChatSeatConfig>;
}

export interface ProviderChatSeatTurnOutcome {
  kind: 'not-mine' | 'refuse' | 'answer';
  posted: string[];
}

export async function runProviderChatSeatTurn(
  deps: ProviderChatSeatTurnDeps
): Promise<ProviderChatSeatTurnOutcome> {
  const posted: string[] = [];
  const post = async (message: string): Promise<void> => {
    if (deps.topicId === undefined) {
      return;
    }
    posted.push(message);
    await deps.post(deps.topicId, message);
  };

  const topicSeats = deps.topicSeats ?? readProviderChatTopicSeats(deps.targetPath);
  const env = deps.env ?? process.env;
  const turn = decideProviderChatTurn({
    topicId: deps.topicId,
    topicSeats,
    env,
  });

  if (turn.kind === 'not-mine') {
    return { kind: turn.kind, posted };
  }
  if (turn.kind === 'refuse') {
    await post(formatProviderChatRefusal(turn));
    return { kind: turn.kind, posted };
  }

  await post(formatProviderChatAcknowledgement(turn.modelId));
  const complete = deps.complete ?? completeWithProviderChat;
  const systemPrompt = [turn.systemPrompt, composeSwarmContextBlock(deps.targetPath)]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n\n');
  try {
    const reply = String(
      await complete(turn.modelId, deps.text, turn.baseUrl, turn.apiKey, systemPrompt || undefined)
    ).trim();
    if (!reply) {
      await post(`Chat seat (${turn.modelId}) returned an empty reply.`);
      return { kind: 'refuse', posted };
    }
    await post(reply);
    return { kind: 'answer', posted };
  } catch (err) {
    await post(`Chat seat cannot answer (${turn.modelId}): ${(err as Error).message}`);
    return { kind: 'refuse', posted };
  }
}
