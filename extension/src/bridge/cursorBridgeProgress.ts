import type { SDKMessage } from '@cursor/sdk';

export type CursorAgentProgressCallback = (line: string) => void | Promise<void>;

function toolLabel(name: string): string {
  return name.length > 48 ? `${name.slice(0, 45)}…` : name;
}

/** Map one SDK stream event to a short user-facing progress line, if any. */
export function summarizeSdkProgressLine(event: SDKMessage): string | undefined {
  switch (event.type) {
    case 'status':
      if (event.status === 'RUNNING') {
        return event.message ? `▶ ${event.message}` : '▶ Agent running…';
      }
      if (event.status === 'CREATING') {
        return '🔄 Starting agent run…';
      }
      return undefined;
    case 'tool_call':
      if (event.status === 'running') {
        return `🔧 ${toolLabel(event.name)}`;
      }
      if (event.status === 'completed') {
        return `✓ ${toolLabel(event.name)}`;
      }
      if (event.status === 'error') {
        return `✗ ${toolLabel(event.name)} failed`;
      }
      return undefined;
    case 'thinking':
      return event.text.trim().length > 0 ? `💭 ${event.text.trim().slice(0, 120)}` : '💭 Thinking…';
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
