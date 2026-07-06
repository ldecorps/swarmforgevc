import * as fs from 'fs';
import * as path from 'path';
import { BounceType } from './bounceWatcher';

// BL-107: a durable acknowledgement for bounce requests. remote_bounce.sh's
// sentinel write is fire-and-forget; the requester (a human or an agent
// polling from a script) cannot otherwise tell "extension draining, be
// patient" from "nobody is listening". The extension host writes this
// sentinel at each phase transition so a requester can poll it directly.
export type BouncePhase = 'draining' | 'stopping' | 'relaunching' | 'done' | 'failed';

export interface BounceAckState {
  bounceType: BounceType;
  phase: BouncePhase;
  updatedAt: string;
  message?: string;
}

const ACK_RELATIVE_PATH = ['.swarmforge', 'bounce-ack.json'];

export function bounceAckPath(targetPath: string): string {
  return path.join(targetPath, ...ACK_RELATIVE_PATH);
}

function isBouncePhase(value: unknown): value is BouncePhase {
  return (
    value === 'draining' ||
    value === 'stopping' ||
    value === 'relaunching' ||
    value === 'done' ||
    value === 'failed'
  );
}

function isBounceType(value: unknown): value is BounceType {
  return value === 'swarm' || value === 'extension' || value === 'all';
}

// Atomic temp+rename, matching bounceDrain.ts's and remote_bounce.sh's
// sentinel-write pattern, so a reader never observes a partially-written file.
export function writeBounceAck(targetPath: string, state: BounceAckState): void {
  const target = bounceAckPath(targetPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, target);
}

export function readBounceAck(targetPath: string): BounceAckState | null {
  try {
    const raw = fs.readFileSync(bounceAckPath(targetPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      isBounceType(parsed.bounceType) &&
      isBouncePhase(parsed.phase) &&
      typeof parsed.updatedAt === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearBounceAck(targetPath: string): void {
  const target = bounceAckPath(targetPath);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

// Pure decision (BL-107 no-listener-03): a bounce request is stale/unheeded
// once its sentinel has sat unprocessed for at least maxAgeMs. Takes an
// explicit clock (sentinelWrittenAtMs, nowMs) rather than touching the
// filesystem so it stays a fast, deterministic unit.
export function isBounceRequestStale(
  sentinelWrittenAtMs: number,
  nowMs: number,
  maxAgeMs: number
): boolean {
  return nowMs - sentinelWrittenAtMs >= maxAgeMs;
}
