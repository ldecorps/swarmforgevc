import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

/**
 * BL-099: sends each committed docs/briefings/<date>.md exactly once,
 * durably across host restarts (briefing-03/07) - the committed file is the
 * source of truth, so a failed send is retried on the next call instead of
 * being lost or silently marked sent.
 */

function sentStatePath(briefingsDir: string): string {
  return path.join(briefingsDir, '.sent.json');
}

export function loadSentBriefings(briefingsDir: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(sentStatePath(briefingsDir), 'utf-8'));
    return new Set(Array.isArray(parsed?.sent) ? parsed.sent : []);
  } catch {
    return new Set();
  }
}

export function recordBriefingSent(briefingsDir: string, fileName: string): void {
  const current = loadSentBriefings(briefingsDir);
  current.add(fileName);
  atomicWrite(sentStatePath(briefingsDir), JSON.stringify({ sent: Array.from(current).sort() }, null, 2));
}

/** Every committed briefing .md file under briefingsDir not yet sent, oldest first. */
export function findUnsentBriefings(briefingsDir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(briefingsDir);
  } catch {
    return [];
  }
  const sent = loadSentBriefings(briefingsDir);
  return entries.filter((name) => name.endsWith('.md') && !sent.has(name)).sort();
}

/** First non-empty line of the briefing, per briefing-03's "subject contains the date and the headline feature". */
export function buildBriefingSubject(dateLabel: string, content: string): string {
  const headline = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return `SwarmForge briefing ${dateLabel}${headline ? ` - ${headline}` : ''}`;
}

export interface BriefingEmailAdapters {
  readBriefingContent: (fileName: string) => string;
  sendEmail: (subject: string, text: string) => Promise<boolean>;
}

/**
 * Sends every not-yet-sent committed briefing exactly once. A file is
 * marked sent only after sendEmail resolves success, so a failed send is
 * retried on the next call rather than being marked sent based on the
 * attempt alone (briefing-03: "email failure never loses the briefing").
 * Sends run sequentially so a slow/failing send can never race the next
 * tick into double-sending the same file.
 */
export async function sendUnsentBriefings(briefingsDir: string, adapters: BriefingEmailAdapters): Promise<string[]> {
  const sentNow: string[] = [];
  for (const fileName of findUnsentBriefings(briefingsDir)) {
    const content = adapters.readBriefingContent(fileName);
    const dateLabel = fileName.replace(/\.md$/, '');
    const subject = buildBriefingSubject(dateLabel, content);
    if (await adapters.sendEmail(subject, content)) {
      recordBriefingSent(briefingsDir, fileName);
      sentNow.push(fileName);
    }
  }
  return sentNow;
}

export function startBriefingEmailWatcher<H>(
  briefingsDir: string,
  adapters: BriefingEmailAdapters,
  intervalMs: number,
  scheduleTick: (fn: () => void, ms: number) => H,
  clearTick: (handle: H) => void
): () => void {
  const handle = scheduleTick(() => {
    void sendUnsentBriefings(briefingsDir, adapters);
  }, intervalMs);
  return () => clearTick(handle);
}
