export type LivenessState = 'alive' | 'idle' | 'stuck' | 'dead' | 'unknown';

export interface HeartbeatSnapshot {
  last_beat: string;
  in_flight: boolean;
  last_tool: string;
  pid: number;
  beat_count: number;
}

export interface WatchdogConfig {
  staleTimeoutSeconds: number;
  inFlightTimeoutSeconds: number;
  deadTimeoutSeconds: number;
}

export interface LivenessResult {
  state: LivenessState;
  label?: string;
}

export function computeLiveness(
  hb: HeartbeatSnapshot | undefined,
  nowMs: number,
  config: WatchdogConfig,
  pidAlive: boolean
): LivenessResult {
  if (!hb) return { state: 'unknown', label: 'waiting for heartbeat' };

  if (!pidAlive) return { state: 'dead', label: 'not responding' };

  const ageSeconds = (nowMs - new Date(hb.last_beat).getTime()) / 1000;

  if (hb.in_flight) {
    if (ageSeconds > config.inFlightTimeoutSeconds) {
      return { state: 'stuck', label: `stuck: ${hb.last_tool}` };
    }
    return { state: 'alive' };
  }

  if (ageSeconds > config.deadTimeoutSeconds) return { state: 'dead', label: 'not responding' };
  if (ageSeconds > config.staleTimeoutSeconds) return { state: 'idle', label: 'idle' };
  return { state: 'alive' };
}
