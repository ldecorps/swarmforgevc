/**
 * BL-1235 (architect D1): the live turn loop for the local-model seat.
 *
 * `localQwenSeat.ts` decides; this performs. It is the caller that module's
 * own docstring describes and that the first build of this ticket left
 * unwritten — without it the seat is unreachable, and posting in the topic
 * does nothing at all.
 *
 * Every edge is injected — the endpoint probe, the completion call, the
 * Telegram send, the clock — so the whole loop is exercised in-process with no
 * network, no ollama and no bot. The default implementations are the real
 * ones.
 *
 * The seat runs INSIDE the existing bridge poll, never as a second poller. One
 * bot token can only have one `getUpdates` consumer: a second one is an
 * immediate 409 and takes the front desk down with it, which would be a
 * spectacular way to honour "cursor stays behind the usual host topic".
 */

import * as fs from 'fs';
import * as path from 'path';
import { NamedModelEndpointProbe, DEFAULT_NAMED_MODEL_ENDPOINT_URL } from '../swarm/modelServing';
import {
  LocalSeatTurn,
  decideLocalSeatTurn,
  formatLocalSeatAcknowledgement,
  formatLocalSeatRefusal,
  qwenLocalTopicIdFromMap,
  resolveLocalSeatModelId,
} from './localQwenSeat';

/** The same topic map the cursor bridge and Bubble resolve their own ids from. */
export function localSeatTopicMapPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'cursor-bridge-topic-map.json');
}

/**
 * The seat's live topic id, or undefined when the operator has not bound one.
 * Undefined is a working state, not an error: the seat then owns no topic, and
 * `decideLocalSeatTurn` answers `not-mine` for every message in the chat.
 */
export function readQwenLocalTopicId(targetPath: string): number | undefined {
  try {
    const map = JSON.parse(fs.readFileSync(localSeatTopicMapPath(targetPath), 'utf8')) as Record<string, string>;
    return qwenLocalTopicIdFromMap(map);
  } catch {
    return undefined;
  }
}

export interface LocalEndpointReading {
  probe: NamedModelEndpointProbe;
  catalogue: string[];
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * What the endpoint is and what it holds, in one reading.
 *
 * A failure is reported with the REASON the runtime gave — the connection
 * error's own message, or the status line plus body — because scenario 03
 * bans a bare status code, and "503" tells an operator nothing they can act
 * on. `unhealthy` is used when the endpoint answered but not usefully, and
 * `missing` when it did not answer at all; the two need different fixes.
 */
export async function readLocalEndpoint(
  endpointUrl: string = DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike
): Promise<LocalEndpointReading> {
  try {
    const res = await fetchFn(`${endpointUrl}/api/tags`);
    if (!res.ok) {
      const body = (await res.text()).trim().slice(0, 200);
      return {
        probe: {
          endpointStatus: 'unhealthy',
          endpointUrl,
          reason: `${endpointUrl}/api/tags answered ${res.status}${body ? `: ${body}` : ''}`,
        },
        catalogue: [],
      };
    }
    const parsed = JSON.parse(await res.text()) as { models?: Array<{ name?: string }> };
    return {
      probe: { endpointStatus: 'healthy', endpointUrl },
      catalogue: (parsed.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean),
    };
  } catch (err) {
    return {
      probe: { endpointStatus: 'missing', endpointUrl, reason: (err as Error).message },
      catalogue: [],
    };
  }
}

/** One completion from the local model. Throws with the endpoint's own words. */
export async function completeWithLocalModel(
  modelId: string,
  prompt: string,
  endpointUrl: string = DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike
): Promise<string> {
  const res = await fetchFn(`${endpointUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelId, prompt, stream: false }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${endpointUrl}/api/generate answered ${res.status}: ${raw.trim().slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw) as { response?: string };
  return String(parsed.response ?? '').trim();
}

export interface LocalSeatTurnDeps {
  targetPath: string;
  topicId: number | undefined;
  seatTopicId: number | undefined;
  text: string;
  post: (topicId: number, message: string) => Promise<void>;
  readEndpoint?: () => Promise<LocalEndpointReading>;
  complete?: (modelId: string, prompt: string, endpointUrl: string) => Promise<string>;
  modelId?: string;
}

export interface LocalSeatTurnOutcome {
  kind: LocalSeatTurn['kind'];
  posted: string[];
}

/**
 * One inbound message, start to finish.
 *
 * `not-mine` posts NOTHING — the seat is not asked, so it does not answer, and
 * that is invariant 1 all the way out to the wire rather than only in the
 * decision.
 *
 * On `answer` the acknowledgement goes out FIRST. This host has no GPU and a
 * measured turn took 3m19s at ~2.8 tok/s; without a first word the topic looks
 * dead for minutes and "the seat is broken" is the reasonable wrong conclusion.
 *
 * A completion that throws becomes a refusal carrying the endpoint's own
 * message, posted in the same topic — the turn fails visibly, in the one place
 * the person who asked is looking, and no other seat is asked to cover.
 */
export async function runLocalSeatTurn(deps: LocalSeatTurnDeps): Promise<LocalSeatTurnOutcome> {
  const posted: string[] = [];
  const post = async (message: string): Promise<void> => {
    if (deps.topicId === undefined) {
      return;
    }
    posted.push(message);
    await deps.post(deps.topicId, message);
  };

  const modelId = resolveLocalSeatModelId(process.env, deps.modelId);
  const readEndpoint = deps.readEndpoint ?? (() => readLocalEndpoint());
  const { probe, catalogue } = await readEndpoint();

  const turn = decideLocalSeatTurn({
    topicId: deps.topicId,
    seatTopicId: deps.seatTopicId,
    probe,
    modelId,
    catalogue,
  });

  if (turn.kind === 'not-mine') {
    return { kind: turn.kind, posted };
  }
  if (turn.kind === 'refuse') {
    await post(formatLocalSeatRefusal(turn));
    return { kind: turn.kind, posted };
  }

  await post(formatLocalSeatAcknowledgement(turn.modelId));
  const complete = deps.complete ?? ((m, p, url) => completeWithLocalModel(m, p, url));
  try {
    // Trimmed here, not only in the default completion call: a reply of pure
    // whitespace posted into the topic is indistinguishable from a broken
    // seat, and the seat is the one that knows it got nothing.
    const reply = String(await complete(turn.modelId, deps.text, turn.endpointUrl)).trim();
    await post(reply || '(the local model returned an empty reply)');
  } catch (err) {
    await post(
      formatLocalSeatRefusal({
        kind: 'refuse',
        reason: (err as Error).message,
        modelId: turn.modelId,
        endpointUrl: turn.endpointUrl,
      })
    );
    return { kind: 'refuse', posted };
  }
  return { kind: turn.kind, posted };
}
