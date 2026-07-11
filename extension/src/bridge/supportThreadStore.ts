// BL-281: the bridge-side (TS) read/write for the SAME SUP-### thread
// store support_thread_store.bb (Babashka) owns for the RC channel -
// mirrors its exact file layout/shape (.swarmforge/support/threads/
// <id>.json) so a thread opened over either channel lives in ONE store,
// never a second implementation. appendMessage is pure (fixture thread +
// fields in, updated thread out); readThread/writeThread are the thin fs
// adapter, mirroring recertification.ts/costTelemetry.ts's own pure+impure
// split.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export interface ThreadMessage {
  channel: string;
  timestamp: string;
  text: string;
}

export interface SupportThread {
  id: string;
  status: string;
  messages: ThreadMessage[];
}

function threadsDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'support', 'threads');
}

function threadPath(targetPath: string, id: string): string {
  return path.join(threadsDir(targetPath), `${id}.json`);
}

export function readThread(targetPath: string, id: string): SupportThread | null {
  try {
    return JSON.parse(fs.readFileSync(threadPath(targetPath, id), 'utf8')) as SupportThread;
  } catch {
    return null;
  }
}

export function writeThread(targetPath: string, thread: SupportThread): void {
  atomicWrite(threadPath(targetPath, thread.id), JSON.stringify(thread));
}

// Pure: appends a message to an existing thread, or opens a fresh one
// (status "open", support_lib.bb's new-thread convention) when none
// exists yet - the bridge route's own "create the thread on first
// mention" fallback, even though the happy path always has one already
// (the Front Desk Bot resolves/creates the SUP-### id before POSTing).
export function appendMessage(thread: SupportThread | null, id: string, channel: string, timestamp: string, text: string): SupportThread {
  const message: ThreadMessage = { channel, timestamp, text };
  if (!thread) {
    return { id, status: 'open', messages: [message] };
  }
  return { ...thread, messages: [...thread.messages, message] };
}
