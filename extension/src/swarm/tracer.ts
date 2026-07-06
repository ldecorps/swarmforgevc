import * as fs from 'fs';
import * as path from 'path';

export interface TraceHop {
  role: string;
  timestamp: Date;
  action?: string;
  state?: string;
  duration?: number;
}

export interface TraceReport {
  pass: boolean;
  traceId: string;
  lastHop: string | null;
  totalDuration: number;
  hops: Array<{
    role: string;
    timestamp: string;
    action?: string;
    state?: string;
    duration?: number;
  }>;
  transitions: Array<{ from: string; to: string; seconds: number }>;
}

const counterMap = new Map<string, number>();

export function generateTraceId(): string {
  const now = new Date();
  const base =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    'T' +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') +
    'z';
  const key = `trace-${base}`;
  const count = counterMap.get(key) ?? 0;
  counterMap.set(key, count + 1);
  return count === 0 ? key : `${key}-${count}`;
}

export function isTRACENote(body: string): boolean {
  return body.startsWith('TRACE ');
}

export function createTraceLog(tracesDir: string, traceId: string, body: string): void {
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.writeFileSync(path.join(tracesDir, `${traceId}.log`), body + '\n', 'utf-8');
}

export function appendTraceHop(
  tracesDir: string,
  traceId: string,
  role: string,
  action?: string,
  state?: string
): void {
  const timestamp = new Date().toISOString();
  let line = `HOP ${role} ${timestamp}`;
  if (action) {
    line += ` action=${action}`;
  }
  if (state) {
    line += ` state=${state}`;
  }
  line += '\n';
  fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}

export function recordAgentDecision(
  tracesDir: string,
  traceId: string,
  role: string,
  decision: string,
  details?: string
): void {
  const timestamp = new Date().toISOString();
  let line = `DECISION ${role} ${timestamp} decision=${decision}`;
  if (details) {
    line += ` details="${details}"`;
  }
  line += '\n';
  fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}

export function recordStateChange(
  tracesDir: string,
  traceId: string,
  role: string,
  fromState: string,
  toState: string,
  reason?: string
): void {
  const timestamp = new Date().toISOString();
  let line = `STATE_CHANGE ${role} ${timestamp} ${fromState}->${toState}`;
  if (reason) {
    line += ` reason="${reason}"`;
  }
  line += '\n';
  fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}

export function recordRetry(
  tracesDir: string,
  traceId: string,
  role: string,
  retryCount: number,
  reason: string
): void {
  const timestamp = new Date().toISOString();
  const line = `RETRY ${role} ${timestamp} attempt=${retryCount} reason="${reason}"\n`;
  fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}

export function parseTraceLog(content: string): TraceHop[] {
  const hops: TraceHop[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Match "TRACE <id> HOP <role> <timestamp>" or "HOP <role> <timestamp>"
    const traceMatch = trimmed.match(/^TRACE\s+\S+\s+HOP\s+(\S+)\s+(\S+)/);
    const hopMatch = trimmed.match(/^HOP\s+(\S+)\s+(\S+)(.*)/);
    const m = traceMatch ?? hopMatch;
    if (!m) {
      continue;
    }
    const ts = new Date(m[2]);
    if (isNaN(ts.getTime())) {
      continue;
    }
    const hop: TraceHop = { role: m[1], timestamp: ts };
    // Parse optional action and state from the line
    if (m[3]) {
      const actionMatch = m[3].match(/action=(\S+)/);
      const stateMatch = m[3].match(/state=(\S+)/);
      if (actionMatch) {
        hop.action = actionMatch[1];
      }
      if (stateMatch) {
        hop.state = stateMatch[1];
      }
    }
    hops.push(hop);
  }
  return hops;
}

export function parseFullTraceLog(content: string): {
  hops: TraceHop[];
  decisions: Array<{ role: string; timestamp: Date; decision: string; details?: string }>;
  stateChanges: Array<{ role: string; timestamp: Date; from: string; to: string; reason?: string }>;
  retries: Array<{ role: string; timestamp: Date; attempt: number; reason: string }>;
} {
  const hops: TraceHop[] = [];
  const decisions: Array<{ role: string; timestamp: Date; decision: string; details?: string }> = [];
  const stateChanges: Array<{ role: string; timestamp: Date; from: string; to: string; reason?: string }> = [];
  const retries: Array<{ role: string; timestamp: Date; attempt: number; reason: string }> = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // HOP entries
    const hopMatch = trimmed.match(/^(?:TRACE\s+\S+\s+)?HOP\s+(\S+)\s+(\S+)(.*)/);
    if (hopMatch) {
      const ts = new Date(hopMatch[2]);
      if (!isNaN(ts.getTime())) {
        const hop: TraceHop = { role: hopMatch[1], timestamp: ts };
        if (hopMatch[3]) {
          const actionMatch = hopMatch[3].match(/action=(\S+)/);
          const stateMatch = hopMatch[3].match(/state=(\S+)/);
          if (actionMatch) {
            hop.action = actionMatch[1];
          }
          if (stateMatch) {
            hop.state = stateMatch[1];
          }
        }
        hops.push(hop);
      }
      continue;
    }

    // DECISION entries
    const decisionMatch = trimmed.match(/^DECISION\s+(\S+)\s+(\S+)\s+decision=(\S+)(.*)/);
    if (decisionMatch) {
      const ts = new Date(decisionMatch[2]);
      if (!isNaN(ts.getTime())) {
        const detailsMatch = decisionMatch[4].match(/details="([^"]*)"/);
        decisions.push({
          role: decisionMatch[1],
          timestamp: ts,
          decision: decisionMatch[3],
          details: detailsMatch?.[1],
        });
      }
      continue;
    }

    // STATE_CHANGE entries
    const stateChangeMatch = trimmed.match(/^STATE_CHANGE\s+(\S+)\s+(\S+)\s+(\S+)->(\S+)(.*)/);
    if (stateChangeMatch) {
      const ts = new Date(stateChangeMatch[2]);
      if (!isNaN(ts.getTime())) {
        const reasonMatch = stateChangeMatch[5].match(/reason="([^"]*)"/);
        stateChanges.push({
          role: stateChangeMatch[1],
          timestamp: ts,
          from: stateChangeMatch[3],
          to: stateChangeMatch[4],
          reason: reasonMatch?.[1],
        });
      }
      continue;
    }

    // RETRY entries
    const retryMatch = trimmed.match(/^RETRY\s+(\S+)\s+(\S+)\s+attempt=(\d+)\s+reason="([^"]*)"/);
    if (retryMatch) {
      const ts = new Date(retryMatch[2]);
      if (!isNaN(ts.getTime())) {
        retries.push({
          role: retryMatch[1],
          timestamp: ts,
          attempt: parseInt(retryMatch[3], 10),
          reason: retryMatch[4],
        });
      }
      continue;
    }
  }

  return { hops, decisions, stateChanges, retries };
}

export function computeTraceReport(
  hops: TraceHop[],
  traceId?: string,
  decisions?: Array<{ role: string; timestamp: Date; decision: string; details?: string }>,
  stateChanges?: Array<{ role: string; timestamp: Date; from: string; to: string; reason?: string }>,
  retries?: Array<{ role: string; timestamp: Date; attempt: number; reason: string }>
): TraceReport {
  if (hops.length === 0) {
    return {
      pass: false,
      traceId: traceId || 'unknown',
      lastHop: null,
      totalDuration: 0,
      hops: [],
      transitions: [],
    };
  }

  const lastHop = hops[hops.length - 1].role;
  // BL-136: the pipeline's terminal role is QA (coordinator -> ... -> QA),
  // not cleaner — cleaner is now a mid-chain hop that forwards to architect.
  const pass = lastHop === 'QA';

  const firstTimestamp = hops[0].timestamp;
  const lastTimestamp = hops[hops.length - 1].timestamp;
  const totalDuration = (lastTimestamp.getTime() - firstTimestamp.getTime()) / 1000;

  const hopsWithDuration = hops.map((hop, i) => ({
    role: hop.role,
    timestamp: hop.timestamp.toISOString(),
    action: hop.action,
    state: hop.state,
    duration:
      i < hops.length - 1
        ? (hops[i + 1].timestamp.getTime() - hop.timestamp.getTime()) / 1000
        : 0,
  }));

  const transitions: TraceReport['transitions'] = [];
  for (let i = 1; i < hops.length; i++) {
    const seconds = (hops[i].timestamp.getTime() - hops[i - 1].timestamp.getTime()) / 1000;
    transitions.push({ from: hops[i - 1].role, to: hops[i].role, seconds });
  }

  return {
    pass,
    traceId: traceId || 'unknown',
    lastHop,
    totalDuration,
    hops: hopsWithDuration,
    transitions,
  };
}
