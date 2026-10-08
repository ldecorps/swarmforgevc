/**
 * Front desk → Host/Bubble bridge inbound fan-out.
 *
 * When front desk and telegram-cursor-bridge share one bot token, only the
 * front desk may call getUpdates. Host/Bubble (and poll_answer) updates are
 * appended here; the bridge drains them instead of competing on Telegram.
 */
import * as fs from 'fs';
import * as path from 'path';
import { appendJsonlUpdate, drainJsonlUpdates } from './jsonlUpdateQueueLib';

export function cursorBridgeInboundQueuePath(opDir: string): string {
  return path.join(opDir, 'cursor-bridge-inbound.jsonl');
}

/** Front-desk bot poll heartbeat — the feeder signal for shared-token queue mode. */
export function frontDeskPollHeartbeatPath(opDir: string): string {
  return path.join(opDir, 'front-desk-poll-heartbeat.json');
}

/**
 * Pure-ish disk read: lastHeartbeatMs from front-desk-poll-heartbeat.json, or
 * null when missing/unreadable. Callers decide liveness via
 * isFrontDeskInboundFeederLive (injected clock).
 */
export function readFrontDeskPollHeartbeatMs(opDir: string): number | null {
  const file = frontDeskPollHeartbeatPath(opDir);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { lastHeartbeatMs?: unknown };
    return typeof raw.lastHeartbeatMs === 'number' && Number.isFinite(raw.lastHeartbeatMs)
      ? raw.lastHeartbeatMs
      : null;
  } catch {
    return null;
  }
}

export function appendCursorBridgeInboundUpdate(opDir: string, update: { update_id?: number } & Record<string, unknown>): void {
  appendJsonlUpdate(cursorBridgeInboundQueuePath(opDir), update);
}

export function drainCursorBridgeInboundUpdates(opDir: string): Array<{ update_id: number } & Record<string, unknown>> {
  return drainJsonlUpdates(cursorBridgeInboundQueuePath(opDir));
}
