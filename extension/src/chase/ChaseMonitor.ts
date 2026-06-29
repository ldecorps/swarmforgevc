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

export function appendChaseEvent(logPath: string, chaseCount: number): void {
  appendEventRaw(logPath, {
    type: 'chased',
    chase_count: chaseCount,
    chased_by: 'watchdog',
    at: new Date().toISOString(),
  });
}

export function appendDeadLetterEvent(logPath: string, chaseCount: number): void {
  appendEventRaw(logPath, {
    type: 'dead-letter',
    chase_count: chaseCount,
    at: new Date().toISOString(),
  });
}
