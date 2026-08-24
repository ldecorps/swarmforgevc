import type { SDKMessage } from '@cursor/sdk';
import {
  isPlayfulProgressEnabled,
  playfulStatusProgressLine,
  playfulToolProgressLabel,
} from './cursorBridgeProgressPlayful';

export type CursorAgentProgressCallback = (line: string) => void | Promise<void>;

/** Progress lines that carry a CreatePlan body for Telegram Confirm/Reject. */
export const PLAN_AWAITING_PROGRESS_PREFIX = '📋 PLAN_AWAITING:\n';

export type CreatePlanAwaiting = { plan: string; callId?: string };

function toolCallName(event: Extract<SDKMessage, { type: 'tool_call' }>): string {
  return String(event.name ?? '');
}

function toolCallArgs(event: Extract<SDKMessage, { type: 'tool_call' }>): Record<string, unknown> | undefined {
  const args = (event as { args?: unknown }).args;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return undefined;
}

/** Detect a running CreatePlan tool_call and return its plan text, if any. */
export function extractCreatePlanAwaiting(event: SDKMessage): CreatePlanAwaiting | undefined {
  if (event.type !== 'tool_call' || event.status !== 'running') {
    return undefined;
  }
  const name = toolCallName(event);
  if (!/create\s*plan/i.test(name) && name !== 'CreatePlan' && name !== 'createPlan') {
    return undefined;
  }
  const args = toolCallArgs(event);
  const plan = typeof args?.plan === 'string' ? args.plan.trim() : '';
  if (!plan) {
    return undefined;
  }
  const callIdRaw = (event as unknown as { callId?: unknown }).callId;
  const callId = typeof callIdRaw === 'string' ? callIdRaw : undefined;
  return { plan, callId };
}

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
  const planAwaiting = extractCreatePlanAwaiting(event);
  if (planAwaiting) {
    // Prefixed so Telegram Live can promote this to a Confirm/Reject prompt
    // instead of a one-line progress drip (plan confirmation must surface).
    return `${PLAN_AWAITING_PROGRESS_PREFIX}${planAwaiting.plan}`;
  }
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
