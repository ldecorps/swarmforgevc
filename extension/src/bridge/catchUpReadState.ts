// BL-545: durable per-message read markers for the Telegram catch-up pager.
// Persists which outbound (agent) topic messages the sponsor has triaged via
// "mark as read" — host-side file, never browser storage (BL-257 discipline).
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export interface CatchUpReadState {
  readKeys: string[];
}

const STATE_RELATIVE_PATH = ['.swarmforge', 'catch-up-read-state.json'];

export function catchUpReadStatePath(targetPath: string): string {
  return path.join(targetPath, ...STATE_RELATIVE_PATH);
}

export function messageReadKey(topicId: string, seq: number): string {
  return `${topicId}:${seq}`;
}

export function readCatchUpReadState(targetPath: string): CatchUpReadState {
  try {
    const raw = fs.readFileSync(catchUpReadStatePath(targetPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.readKeys) && parsed.readKeys.every((k: unknown) => typeof k === 'string')) {
      return { readKeys: parsed.readKeys };
    }
  } catch {
    // missing or corrupt — treat as nothing read yet
  }
  return { readKeys: [] };
}

export function isMessageRead(state: CatchUpReadState, topicId: string, seq: number): boolean {
  const key = messageReadKey(topicId, seq);
  return state.readKeys.includes(key);
}

// Pure: returns a new state with the message marked read (idempotent).
export function withMessageMarkedRead(state: CatchUpReadState, topicId: string, seq: number): CatchUpReadState {
  const key = messageReadKey(topicId, seq);
  if (state.readKeys.includes(key)) {
    return state;
  }
  return { readKeys: [...state.readKeys, key] };
}

export function writeCatchUpReadState(targetPath: string, state: CatchUpReadState): void {
  atomicWrite(catchUpReadStatePath(targetPath), JSON.stringify(state, null, 2));
}

export function markMessageRead(targetPath: string, topicId: string, seq: number): CatchUpReadState {
  const next = withMessageMarkedRead(readCatchUpReadState(targetPath), topicId, seq);
  writeCatchUpReadState(targetPath, next);
  return next;
}
