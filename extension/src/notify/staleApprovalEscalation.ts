// BL-584: escalate unanswered Approvals-topic asks to email with a Telegram
// deep link. Pure helpers + an injected sweep — no vscode imports (front-desk
// bot runs headless).
import * as fs from 'fs';
import * as path from 'path';
import type { TopicRecord } from '../concierge/blTopicStore';
import { APPROVAL_ASK_LOCATOR } from '../concierge/topicRouter';
import { forEachLiveTicketFile } from '../util/liveTicketFiles';
import { decideNotifyAction } from './needsHumanEmailNotifier';
import type { EmailMessage, SendEmailResult } from './resendClient';

export const DEFAULT_STALE_AFTER_MS = 7_200_000;
export const DEFAULT_COOLDOWN_MS = 14_400_000;

export function resolvePositiveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function staleApprovalEscalationStatePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'stale-approval-escalation.json');
}

export function readLastStaleApprovalEmailMs(targetPath: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(staleApprovalEscalationStatePath(targetPath), 'utf8')) as {
      lastSentMs?: unknown;
    };
    return typeof parsed.lastSentMs === 'number' && Number.isFinite(parsed.lastSentMs)
      ? parsed.lastSentMs
      : null;
  } catch {
    return null;
  }
}

export function writeLastStaleApprovalEmailMs(targetPath: string, ms: number): void {
  const file = staleApprovalEscalationStatePath(targetPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lastSentMs: ms }));
}

export type ApprovalAskState = 'pending' | 'amending' | 'approved' | 'rejected' | 'absent';

export function parseHumanApprovalState(yamlText: string): ApprovalAskState {
  const match = yamlText.match(/^human_approval:\s*(\S+)/m);
  if (!match) {
    return 'absent';
  }
  const raw = match[1];
  if (raw === 'pending' || raw === 'pending-review') {
    return 'pending';
  }
  if (raw === 'amending' || raw === 'approved' || raw === 'rejected') {
    return raw;
  }
  return 'absent';
}

export interface StaleAskCandidate {
  id: string;
  state: ApprovalAskState;
  topicRecord: TopicRecord | undefined;
  askMessageId: number | undefined;
  askTopicId: number | undefined;
}

export interface LiveAskCandidateReaders {
  readTopicRecord: (id: string) => TopicRecord | undefined;
  readAskMessages: () => Record<string, { topicId: number; messageId: number }>;
}

function ticketIdFromYaml(yamlText: string): string | undefined {
  const match = yamlText.match(/^id:\s*(\S+)/m);
  return match ? match[1] : undefined;
}

// Disk scan used by the front-desk wiring — kept here so unit tests prove
// the live folder walk + YAML parse are load-bearing, not only faked.
export function listLiveApprovalAskCandidates(
  targetPath: string,
  readers: LiveAskCandidateReaders
): StaleAskCandidate[] {
  const asks = readers.readAskMessages();
  const out: StaleAskCandidate[] = [];
  forEachLiveTicketFile(targetPath, (filePath) => {
    let yamlText: string;
    try {
      yamlText = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    const id = ticketIdFromYaml(yamlText);
    if (!id) {
      return;
    }
    const stored = asks[id];
    out.push({
      id,
      state: parseHumanApprovalState(yamlText),
      topicRecord: readers.readTopicRecord(id),
      askMessageId: stored?.messageId,
      askTopicId: stored?.topicId,
    });
  });
  return out;
}

export interface StaleAskEntry {
  id: string;
  state: ApprovalAskState;
  waitedSinceMs: number;
  askMessageId: number | undefined;
  askTopicId: number | undefined;
  deepLink: string | undefined;
}

export function approvalAskPostedAtMs(record: TopicRecord | undefined): number | undefined {
  if (!record) {
    return undefined;
  }
  let latest: number | undefined;
  for (const message of record.messages) {
    if (message.type !== 'outbound') {
      continue;
    }
    if (!message.text.includes(APPROVAL_ASK_LOCATOR)) {
      continue;
    }
    if (latest === undefined || message.ts > latest) {
      latest = message.ts;
    }
  }
  return latest;
}

export function lastHumanActivityMs(record: TopicRecord | undefined): number | undefined {
  if (!record) {
    return undefined;
  }
  let latest: number | undefined;
  for (const message of record.messages) {
    if (message.type !== 'inbound') {
      continue;
    }
    if (latest === undefined || message.ts > latest) {
      latest = message.ts;
    }
  }
  return latest;
}

function askClockMs(record: TopicRecord | undefined): number | undefined {
  const posted = approvalAskPostedAtMs(record);
  if (posted === undefined) {
    return undefined;
  }
  const human = lastHumanActivityMs(record);
  return human === undefined ? posted : Math.max(posted, human);
}

export function selectStaleApprovalAsks(
  candidates: StaleAskCandidate[],
  nowMs: number,
  thresholdMs: number
): StaleAskEntry[] {
  const stale: StaleAskEntry[] = [];
  for (const candidate of candidates) {
    if (candidate.state !== 'pending' && candidate.state !== 'amending') {
      continue;
    }
    const clock = askClockMs(candidate.topicRecord);
    if (clock === undefined) {
      continue;
    }
    if (nowMs - clock < thresholdMs) {
      continue;
    }
    stale.push({
      id: candidate.id,
      state: candidate.state,
      waitedSinceMs: clock,
      askMessageId: candidate.askMessageId,
      askTopicId: candidate.askTopicId,
      deepLink: undefined,
    });
  }
  stale.sort((a, b) => a.waitedSinceMs - b.waitedSinceMs);
  return stale;
}

export function buildTelegramDeepLink(
  chatId: string,
  topicId: number,
  messageId?: number
): string | undefined {
  const stripped = chatId.startsWith('-100') ? chatId.slice(4) : chatId;
  if (!/^\d+$/.test(stripped)) {
    return undefined;
  }
  if (topicId === undefined || topicId === null || Number.isNaN(topicId)) {
    return undefined;
  }
  const base = `https://t.me/c/${stripped}/${topicId}`;
  return messageId === undefined ? base : `${base}/${messageId}`;
}

function formatWaited(nowMs: number, sinceMs: number): string {
  const hours = Math.max(0, Math.floor((nowMs - sinceMs) / 3_600_000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor((nowMs - sinceMs) / 60_000));
    return `${minutes}m`;
  }
  return `${hours}h`;
}

export function buildStaleApprovalDigest(
  entries: StaleAskEntry[],
  nowMs: number
): { subject: string; text: string } {
  const subject =
    entries.length === 1
      ? `Stale approval ask: ${entries[0].id}`
      : `Stale approval asks: ${entries.length} tickets`;
  const lines = entries.map((entry) => {
    const wait = formatWaited(nowMs, entry.waitedSinceMs);
    const link = entry.deepLink ? ` ${entry.deepLink}` : '';
    return `- ${entry.id} (${entry.state}, waiting ${wait})${link}`;
  });
  const text = [
    'These approval asks have gone unanswered past the configured threshold:',
    '',
    ...lines,
    '',
    'Open a link to jump to that ask in the Approvals topic.',
  ].join('\n');
  return { subject, text };
}

export interface StaleApprovalSweepConfig {
  to: string | undefined;
  from: string;
  chatId: string;
  staleAfterMs: number;
  cooldownMs: number;
}

export interface StaleApprovalSweepAdapters {
  nowMs: () => number;
  listCandidates: () => StaleAskCandidate[];
  sendEmail: (message: EmailMessage) => Promise<SendEmailResult>;
  readLastSentMs: () => number | null;
  writeLastSentMs: (ms: number) => void;
  readApiKey: () => string | undefined;
  warnMissingApiKey: () => void;
}

let missingKeyWarned = false;

export function resetStaleApprovalMissingKeyWarningForTests(): void {
  missingKeyWarned = false;
}

export async function sweepStaleApprovalAsks(
  config: StaleApprovalSweepConfig,
  adapters: StaleApprovalSweepAdapters
): Promise<'sent' | 'not-sent' | 'warned'> {
  if (!config.to) {
    return 'not-sent';
  }
  const apiKey = adapters.readApiKey();
  if (!apiKey) {
    if (!missingKeyWarned) {
      adapters.warnMissingApiKey();
      missingKeyWarned = true;
    }
    return 'warned';
  }

  const nowMs = adapters.nowMs();
  const selected = selectStaleApprovalAsks(adapters.listCandidates(), nowMs, config.staleAfterMs);
  if (selected.length === 0) {
    return 'not-sent';
  }

  const oldest = selected[0].waitedSinceMs;
  const action = decideNotifyAction(oldest, adapters.readLastSentMs(), nowMs, {
    graceSeconds: config.staleAfterMs / 1000,
    cooldownSeconds: config.cooldownMs / 1000,
  });
  if (action !== 'send') {
    return 'not-sent';
  }

  const withLinks = selected.map((entry) => ({
    ...entry,
    deepLink:
      entry.askTopicId === undefined
        ? undefined
        : buildTelegramDeepLink(config.chatId, entry.askTopicId, entry.askMessageId),
  }));
  const digest = buildStaleApprovalDigest(withLinks, nowMs);
  adapters.writeLastSentMs(nowMs);
  await adapters.sendEmail({
    to: config.to,
    from: config.from,
    subject: digest.subject,
    text: digest.text,
  });
  return 'sent';
}
