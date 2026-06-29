import { appendEventRaw } from '../swarm/messageBus';
import type { LivenessState } from '../watchdog/liveness';

export type ChaseEventResult = 'chased' | 'dead-lettered' | 'skipped' | 'already-done';

export interface ChaseConfig {
  chaseTimeoutSeconds: number;
  maxChases: number;
}

export interface MessageEventRecord {
  event: string;
  chase_count?: number;
  at: string;
  [key: string]: unknown;
}

export function evaluateChase(
  events: MessageEventRecord[],
  nowMs: number,
  config: ChaseConfig,
  receiverLiveness: LivenessState
): ChaseEventResult {
  if (events.length === 0) return 'skipped';

  const last = events[events.length - 1];
  if (last.event === 'done' || last.event === 'dead-letter' || last.event === 'received') {
    return 'already-done';
  }

  if (receiverLiveness === 'dead' || receiverLiveness === 'unknown' || receiverLiveness === 'stuck') {
    return 'skipped';
  }

  const createdEvent = events.find((e) => e.event === 'created');
  if (!createdEvent) return 'skipped';

  const ageSeconds = (nowMs - new Date(createdEvent.at).getTime()) / 1000;
  if (ageSeconds < config.chaseTimeoutSeconds) return 'skipped';

  const chaseCount = events.filter((e) => e.event === 'chased').length;
  if (chaseCount >= config.maxChases) return 'dead-lettered';

  return 'chased';
}

function appendChaseEventInternal(logPath: string, type: 'chased' | 'dead-letter', chaseCount: number): void {
  const event: Record<string, unknown> = {
    type,
    chase_count: chaseCount,
    at: new Date().toISOString(),
  };
  if (type === 'chased') event.chased_by = 'watchdog';
  appendEventRaw(logPath, event);
}

export function appendChaseEvent(logPath: string, chaseCount: number): void {
  appendChaseEventInternal(logPath, 'chased', chaseCount);
}

export function appendDeadLetterEvent(logPath: string, chaseCount: number): void {
  appendChaseEventInternal(logPath, 'dead-letter', chaseCount);
}
