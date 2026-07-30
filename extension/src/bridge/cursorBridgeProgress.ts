import type { SDKMessage } from '@cursor/sdk';
import {
  isPlayfulProgressEnabled,
  playfulStatusProgressLine,
  playfulToolProgressLabel,
} from './cursorBridgeProgressPlayful';

export type CursorAgentProgressCallback = (line: string) => void | Promise<void>;

function toolLabel(name: string): string {
  return name.length > 48 ? `${name.slice(0, 45)}…` : name;
}

function formatToolProgress(name: string, phase: 'running' | 'completed' | 'error'): string {
  if (isPlayfulProgressEnabled()) {
    return playfulToolProgressLabel(name, phase);
  }
  const label = toolLabel(name);
  if (phase === 'running') {
    return `🔧 ${label}`;
  }
  if (phase === 'completed') {
    return `✓ ${label}`;
  }
  return `✗ ${label} failed`;
}

const THINKING_PROGRESS_MIN_CHARS = 40;

function shouldPostThinkingProgress(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.length >= THINKING_PROGRESS_MIN_CHARS) {
    return true;
  }
  return trimmed.length >= 24 && /[.!?…]$/.test(trimmed);
}

/** Map one SDK stream event to a short user-facing progress line, if any. */
export function summarizeSdkProgressLine(event: SDKMessage): string | undefined {
  switch (event.type) {
    case 'status':
      if (event.status === 'RUNNING') {
        if (isPlayfulProgressEnabled()) {
          return playfulStatusProgressLine('RUNNING', event.message);
        }
        return event.message ? `▶ ${event.message}` : '▶ Agent running…';
      }
      if (event.status === 'CREATING') {
        if (isPlayfulProgressEnabled()) {
          return playfulStatusProgressLine('CREATING');
        }
        return '🔄 Starting agent run…';
      }
      return undefined;
    case 'tool_call':
      if (event.status === 'running') {
        return formatToolProgress(event.name, 'running');
      }
      if (event.status === 'completed') {
        return formatToolProgress(event.name, 'completed');
      }
      if (event.status === 'error') {
        return formatToolProgress(event.name, 'error');
      }
      return undefined;
    case 'thinking': {
      const trimmed = event.text.trim();
      if (trimmed.length === 0) {
        return undefined;
      }
      if (!shouldPostThinkingProgress(trimmed)) {
        return undefined;
      }
      return `💭 ${trimmed.slice(0, 120)}`;
    }
    case 'task':
      return event.text?.trim() ? `📋 ${event.text.trim().slice(0, 120)}` : undefined;
    default:
      return undefined;
  }
}

export function createThrottledProgressReporter(
  minIntervalMs: number,
  post: CursorAgentProgressCallback,
  now: () => number = Date.now
): CursorAgentProgressCallback {
  let lastAt = 0;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    if (!pending) {
      return;
    }
    const line = pending;
    pending = undefined;
    lastAt = now();
    await post(line);
  };

  return (line: string) => {
    pending = line;
    const elapsed = now() - lastAt;
    if (elapsed >= minIntervalMs) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      return flush();
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, minIntervalMs - elapsed);
    }
  };
}
