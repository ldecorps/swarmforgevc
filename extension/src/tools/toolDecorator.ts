import { writeHeartbeat, HeartbeatData } from './heartbeat';

const beatCounts = new Map<string, number>();

export function withHeartbeat<T>(
  heartbeatDir: string,
  role: string,
  pid: number,
  toolName: string,
  fn: () => T | Promise<T>
): T extends Promise<unknown> ? Promise<Awaited<T>> : T {
  const prev = beatCounts.get(role) ?? 0;
  const count = prev + 1;
  beatCounts.set(role, count);

  const timestamp = new Date().toISOString();
  const writeState = (phase: 'entry' | 'exit', in_flight: boolean) => {
    const data: HeartbeatData = { role, pid, last_beat: timestamp, last_tool: toolName, phase, in_flight, beat_count: count };
    writeHeartbeat(heartbeatDir, data);
  };

  writeState('entry', true);
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (err) {
    writeState('exit', false);
    throw err;
  }

  if (result instanceof Promise) {
    return result.then(
      (v) => { writeState('exit', false); return v; },
      (err) => { writeState('exit', false); throw err; }
    ) as ReturnType<typeof withHeartbeat<T>>;
  }

  writeState('exit', false);
  return result as ReturnType<typeof withHeartbeat<T>>;
}

export function resetBeatCount(role?: string): void {
  if (role !== undefined) {
    beatCounts.delete(role);
  } else {
    beatCounts.clear();
  }
}
