// Approvals ask "More" — loads the ticket's full spec + Gherkin scenarios
// for an in-topic follow-up message. Pure formatting stays here; disk I/O
// is isolated in loadApprovalMoreText so unit tests cover the render
// contract without Telegram or the filesystem.

import * as fs from 'fs';
import * as path from 'path';
import { isFeatureFilePath } from '../docs/docsTree';
import { BacklogItem, readBacklogFolders } from '../panel/backlogReader';

// Telegram sendMessage hard cap. Keep a small margin for the truncation
// notice so a borderline body never exceeds the wire limit.
export const APPROVAL_MORE_TELEGRAM_CAP = 4000;

export interface ApprovalMoreContent {
  backlogId: string;
  title?: string;
  spec?: string;
  gherkin?: string;
}

export function formatApprovalMoreText(content: ApprovalMoreContent): string {
  const titleLine = content.title ? `${content.backlogId} — ${content.title}` : content.backlogId;
  const specBody = (content.spec && content.spec.trim()) || '(no spec on disk for this ticket)';
  const gherkinBody = (content.gherkin && content.gherkin.trim()) || '(no Gherkin scenarios on disk for this ticket)';
  const text = `${titleLine}\n\n— Spec —\n${specBody}\n\n— Gherkin —\n${gherkinBody}`;
  if (text.length <= APPROVAL_MORE_TELEGRAM_CAP) {
    return text;
  }
  const notice = '\n\n… (truncated for Telegram)';
  return text.slice(0, APPROVAL_MORE_TELEGRAM_CAP - notice.length) + notice;
}

// Prefer description (the full APS prose) over notes; either may be absent
// on older tickets. Never invents content — missing sections degrade to the
// explicit placeholders in formatApprovalMoreText.
export function approvalMoreContentFromItem(item: BacklogItem, gherkin?: string): ApprovalMoreContent {
  const spec = item.description?.trim() || item.notes?.trim() || undefined;
  return {
    backlogId: item.id,
    title: item.title,
    ...(spec ? { spec } : {}),
    ...(gherkin?.trim() ? { gherkin: gherkin.trim() } : {}),
  };
}

export function resolveAcceptanceGherkinText(targetPath: string, acceptance: string | undefined): string | undefined {
  if (!acceptance) {
    return undefined;
  }
  if (!isFeatureFilePath(acceptance)) {
    return acceptance;
  }
  try {
    return fs.readFileSync(path.join(targetPath, acceptance.trim()), 'utf8');
  } catch {
    return undefined;
  }
}

function findBacklogItem(targetPath: string, backlogId: string): BacklogItem | undefined {
  const folders = readBacklogFolders(targetPath);
  const needle = backlogId.toUpperCase();
  return [...folders.active, ...folders.paused, ...folders.done].find((item) => item.id.toUpperCase() === needle);
}

// Impure entry: loads the ticket from backlog folders and resolves its
// acceptance into Gherkin text. Always returns a renderable string — missing
// ticket / missing files become the same placeholders the pure formatter uses.
export function loadApprovalMoreText(targetPath: string, backlogId: string): string {
  const item = findBacklogItem(targetPath, backlogId);
  if (!item) {
    return formatApprovalMoreText({ backlogId });
  }
  const gherkin = resolveAcceptanceGherkinText(targetPath, item.acceptance);
  return formatApprovalMoreText(approvalMoreContentFromItem(item, gherkin));
}
