import { writeHeartbeat, HeartbeatData } from './heartbeat';

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
  const timestamp = new Date().toISOString();
  const writeHeartbeatState = (phase: 'entry' | 'exit', in_flight: boolean) => {
    const data: HeartbeatData = { role, pid, last_beat: timestamp, last_tool: toolName, phase, in_flight, beat_count: count };
    writeHeartbeat(heartbeatDir, data);
  };
  writeHeartbeatState('entry', true);
  try {
    const result = fn();
    writeHeartbeatState('exit', false);
    return result;
  } catch (err) {
    writeHeartbeatState('exit', false);
    throw err;
  }
}

export function resetBeatCount(): void {
  beatCount = 0;
}
