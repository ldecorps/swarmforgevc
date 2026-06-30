import * as fs from 'fs';
import * as path from 'path';

export interface TraceHop {
  role: string;
  timestamp: Date;
}

export interface TraceReport {
  pass: boolean;
  lastHop: string | null;
  latencies: Array<{ from: string; to: string; seconds: number }>;
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

export function appendTraceHop(tracesDir: string, traceId: string, role: string): void {
  const timestamp = new Date().toISOString();
  const line = `HOP ${role} ${timestamp}\n`;
  fs.appendFileSync(path.join(tracesDir, `${traceId}.log`), line, 'utf-8');
}

export function parseTraceLog(content: string): TraceHop[] {
  const hops: TraceHop[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Match "TRACE <id> HOP <role> <timestamp>" or "HOP <role> <timestamp>"
    const traceMatch = trimmed.match(/^TRACE\s+\S+\s+HOP\s+(\S+)\s+(\S+)/);
    const hopMatch = trimmed.match(/^HOP\s+(\S+)\s+(\S+)/);
    const m = traceMatch ?? hopMatch;
    if (!m) {
      continue;
    }
    const ts = new Date(m[2]);
    if (isNaN(ts.getTime())) {
      continue;
    }
    hops.push({ role: m[1], timestamp: ts });
  }
  return hops;
}

export function computeTraceReport(hops: TraceHop[]): TraceReport {
  if (hops.length === 0) {
    return { pass: false, lastHop: null, latencies: [] };
  }
  const lastHop = hops[hops.length - 1].role;
  const pass = lastHop === 'cleaner';
  const latencies: TraceReport['latencies'] = [];
  for (let i = 1; i < hops.length; i++) {
    const seconds = (hops[i].timestamp.getTime() - hops[i - 1].timestamp.getTime()) / 1000;
    latencies.push({ from: hops[i - 1].role, to: hops[i].role, seconds });
  }
  return { pass, lastHop, latencies };
}
