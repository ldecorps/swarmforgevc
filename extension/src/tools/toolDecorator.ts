import { writeHeartbeat } from './heartbeat';

let beatCount = 0;

export function withHeartbeat<T>(
  heartbeatDir: string,
  role: string,
  pid: number,
  toolName: string,
  fn: () => T
): T {
  beatCount++;
  const count = beatCount;
  const at = () => new Date().toISOString();
  writeHeartbeat(heartbeatDir, { role, pid, last_beat: at(), last_tool: toolName, phase: 'entry', in_flight: true, beat_count: count });
  try {
    const result = fn();
    writeHeartbeat(heartbeatDir, { role, pid, last_beat: at(), last_tool: toolName, phase: 'exit', in_flight: false, beat_count: count });
    return result;
  } catch (err) {
    writeHeartbeat(heartbeatDir, { role, pid, last_beat: at(), last_tool: toolName, phase: 'exit', in_flight: false, beat_count: count });
    throw err;
  }
}

export function resetBeatCount(): void {
  beatCount = 0;
}
