// BL-239: narrates one run's key events into a single Telegram thread. A
// "thread" here is a native Telegram reply chain, not a forum-topic: the
// first message posted for a run has no reply target; every later message
// for that SAME run replies to that first message's id, so Telegram groups
// them visibly under it. Diffing is pure (diffNarrationEvents); the class
// only adds the per-run "what have we already told the human" memory and the
// bounded-retry send.
import { NarrationSnapshot } from './telegramNarrationSnapshot';
import { TelegramRetryConfig, sendWithBoundedRetry, BoundedRetryResult } from './telegramRetry';

export type NarrationEventKind = 'stage-transition' | 'gate' | 'dead-letter' | 'pr-link';

export interface NarrationEvent {
  kind: NarrationEventKind;
  text: string;
  // Present only for 'gate' events - the role a Telegram reply to this
  // specific message should be relayed to as a gate answer (wired up by
  // extension.ts feeding TelegramNarrator's onSendResult into
  // TelegramInboundRelay.recordGatePrompt).
  role?: string;
}

// Pure: given the run's previous narrated snapshot (or null for a run never
// narrated before) and its current snapshot, compute the NEW events to post.
// Never re-derives anything already told to the human - only transitions
// (active<->idle), newly-appeared gates, newly-appeared dead-letters, and a
// PR link the first time it appears are ever emitted.
export function diffNarrationEvents(prev: NarrationSnapshot | null, curr: NarrationSnapshot): NarrationEvent[] {
  const events: NarrationEvent[] = [];

  const prevStatusByRole = new Map((prev?.pipeline ?? []).map((p) => [p.role, p.status]));
  for (const stage of curr.pipeline) {
    const before = prevStatusByRole.get(stage.role);
    if (before !== undefined && before !== stage.status) {
      events.push({ kind: 'stage-transition', text: `${stage.role}: ${before} -> ${stage.status}` });
    }
  }

  const wasGatedByRole = new Map((prev?.gates ?? []).map((g) => [g.role, g.gated]));
  for (const gate of curr.gates) {
    const wasGated = wasGatedByRole.get(gate.role) ?? false;
    if (gate.gated && !wasGated) {
      events.push({
        kind: 'gate',
        text: `${gate.role} needs you${gate.snippet ? `: ${gate.snippet}` : ''}`,
        role: gate.role,
      });
    }
  }

  const priorDeadLetterPaths = new Set((prev?.deadLetters ?? []).map((d) => d.filePath));
  for (const deadLetter of curr.deadLetters) {
    if (!priorDeadLetterPaths.has(deadLetter.filePath)) {
      events.push({
        kind: 'dead-letter',
        text: `dead-letter for ${deadLetter.role}${deadLetter.task ? `: ${deadLetter.task}` : ''}`,
      });
    }
  }

  if (curr.prUrl && curr.prUrl !== (prev?.prUrl ?? null)) {
    events.push({ kind: 'pr-link', text: `PR ready: ${curr.prUrl}` });
  }

  return events;
}

export interface TelegramNarratorAdapters {
  sendOnce: (text: string, replyToMessageId?: number) => Promise<{ success: boolean; messageId?: number; error?: string }>;
  onSendResult?: (event: NarrationEvent, result: BoundedRetryResult) => void;
  wait?: (ms: number) => Promise<void>;
}

interface RunNarrationState {
  lastSnapshot: NarrationSnapshot | null;
  threadRootMessageId: number | undefined;
}

export class TelegramNarrator {
  private runs = new Map<string, RunNarrationState>();

  constructor(
    private retryConfig: TelegramRetryConfig,
    private adapters: TelegramNarratorAdapters
  ) {}

  async sweep(snapshot: NarrationSnapshot, nowMs: number): Promise<void> {
    void nowMs; // reserved for a future rate-limit window; not needed yet
    const state = this.runs.get(snapshot.runName) ?? { lastSnapshot: null, threadRootMessageId: undefined };
    const events = diffNarrationEvents(state.lastSnapshot, snapshot);
    state.lastSnapshot = snapshot;
    this.runs.set(snapshot.runName, state);

    for (const event of events) {
      const result = await sendWithBoundedRetry(
        () => this.adapters.sendOnce(event.text, state.threadRootMessageId),
        this.retryConfig,
        this.adapters.wait
      );
      if (result.success && state.threadRootMessageId === undefined && result.messageId !== undefined) {
        state.threadRootMessageId = result.messageId;
      }
      this.adapters.onSendResult?.(event, result);
    }
  }
}
