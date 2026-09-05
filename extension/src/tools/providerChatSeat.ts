/**
 * Operator test seats: bind a Telegram forum topic to a direct
 * OpenAI-compatible chat provider (DeepSeek, NVIDIA NIM, …) — never OpenRouter.
 *
 * Runtime map (gitignored): `.swarmforge/operator/provider-chat-topic-map.json`
 * Shape:
 *   {
 *     "<message_thread_id>": {
 *       "model": "<model-id>",
 *       "baseUrl": "https://api.deepseek.com",
 *       "apiKeyEnv": "DEEPSEEK_API_KEY",
 *       "systemPrompt": "<optional static orientation text>"
 *     },
 *     ...
 *   }
 *
 * systemPrompt is static per-seat config (this file stays pure/no IO); a
 * live-composed swarm-state snapshot is appended to it server-side by
 * providerChatSeatLive.ts before the request goes out, so the seat has some
 * genuine current-state grounding without needing tool-calling from the
 * model itself. This is a lighter parity with the Host (Cursor) topic's
 * real tool-using agent session, not an attempt to replicate it — a plain
 * chat-completions call has no tools to reach for.
 *
 * Pure decision only — I/O lives in providerChatSeatLive.ts.
 */

export const PROVIDER_CHAT_TOPIC_MAP_REL = [
  '.swarmforge',
  'operator',
  'provider-chat-topic-map.json',
] as const;

export interface ProviderChatSeatConfig {
  model: string;
  /** OpenAI-compatible root, e.g. https://api.deepseek.com or https://integrate.api.nvidia.com/v1 */
  baseUrl: string;
  /** Process env var that holds the bearer token for this seat. */
  apiKeyEnv: string;
  /** Optional static orientation text, sent as the system message. */
  systemPrompt?: string;
}

export type ProviderChatTurn =
  | { kind: 'not-mine' }
  | { kind: 'refuse'; reason: string; modelId: string }
  | { kind: 'answer'; modelId: string; baseUrl: string; apiKey: string; systemPrompt?: string };

export interface ProviderChatTurnInput {
  topicId: number | undefined;
  topicSeats: Record<string, ProviderChatSeatConfig>;
  env: Record<string, string | undefined>;
}

export function seatForProviderChatTopic(
  topicSeats: Record<string, ProviderChatSeatConfig>,
  topicId: number | undefined
): ProviderChatSeatConfig | undefined {
  if (topicId === undefined) {
    return undefined;
  }
  return topicSeats[String(topicId)];
}

interface NormalizedSeatConfig {
  modelId: string;
  baseUrl: string;
  apiKeyEnv: string;
}

/** Trim every seat field once, in one place - decideProviderChatTurn's own
 * complexity budget goes to the DECISION, not to string cleanup. */
function normalizeSeatConfig(seat: ProviderChatSeatConfig): NormalizedSeatConfig {
  return {
    modelId: String(seat.model ?? '').trim(),
    baseUrl: String(seat.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, ''),
    apiKeyEnv: String(seat.apiKeyEnv ?? '').trim(),
  };
}

function seatConfigIsComplete(cfg: NormalizedSeatConfig): boolean {
  return Boolean(cfg.modelId && cfg.baseUrl && cfg.apiKeyEnv);
}

function resolveApiKey(env: Record<string, string | undefined>, apiKeyEnv: string): string {
  return String(env[apiKeyEnv] ?? '').trim();
}

export function decideProviderChatTurn(input: ProviderChatTurnInput): ProviderChatTurn {
  const seat = seatForProviderChatTopic(input.topicSeats, input.topicId);
  if (!seat) {
    return { kind: 'not-mine' };
  }
  const cfg = normalizeSeatConfig(seat);
  if (!seatConfigIsComplete(cfg)) {
    return {
      kind: 'refuse',
      reason: 'seat config is incomplete (need model, baseUrl, apiKeyEnv)',
      modelId: cfg.modelId || '(unset)',
    };
  }
  const apiKey = resolveApiKey(input.env, cfg.apiKeyEnv);
  if (!apiKey) {
    return {
      kind: 'refuse',
      reason: `${cfg.apiKeyEnv} is not set in the front-desk process environment`,
      modelId: cfg.modelId,
    };
  }
  const systemPrompt = seat.systemPrompt !== undefined ? String(seat.systemPrompt) : undefined;
  return { kind: 'answer', modelId: cfg.modelId, baseUrl: cfg.baseUrl, apiKey, systemPrompt };
}

export function formatProviderChatRefusal(
  turn: Extract<ProviderChatTurn, { kind: 'refuse' }>
): string {
  return `Chat seat cannot answer (${turn.modelId}): ${turn.reason}.`;
}

export function formatProviderChatAcknowledgement(modelId: string): string {
  return `Chat seat working on it with ${modelId}.`;
}
