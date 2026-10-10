// Article drafts Mini App — list and render LinkedIn DRAFT-*.md under
// .swarmforge/operator/ (sibling of BL-1166 Operator docs; reuses its
// markdown→HTML renderer).
import {
  deriveDocTitle,
  markdownToOperatorDocsHtml,
} from './operatorDocsCore';
import { replyTextForSpeechSynthesis } from './letsTalkCore';

export const ARTICLE_DRAFTS_READ_ROUTE_PATHS = [
  '/article-drafts',
  '/article-drafts-index',
  '/article-drafts-page',
] as const;

export const ARTICLE_DRAFT_FILENAME_RE = /^DRAFT-linkedin-[A-Za-z0-9._-]+\.md$/;

export interface ArticleDraftIndexEntry {
  file: string;
  title: string;
  /** Plain prose for on-device speechSynthesis (Listen button). */
  speechText: string;
}

export interface ArticleDraftsIndexPayload {
  drafts: ArticleDraftIndexEntry[];
}

export interface ArticleDraftPagePayload {
  file: string;
  title: string;
  html: string;
  speechText: string;
}

/** Basename only; must match DRAFT-linkedin-*.md; no path separators. */
export function isSafeArticleDraftFilename(file: string): boolean {
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) {
    return false;
  }
  return ARTICLE_DRAFT_FILENAME_RE.test(file);
}

/** Body after the first standalone `---` line; whole file if none. */
export function stripDraftMetaHeader(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sep = lines.findIndex((line) => line.trim() === '---');
  if (sep < 0) {
    return markdown;
  }
  return lines.slice(sep + 1).join('\n').replace(/^\n+/, '');
}

export function deriveArticleDraftTitle(bodyMarkdown: string, filename: string): string {
  const fromHeading = deriveDocTitle(bodyMarkdown, '');
  if (fromHeading) {
    return fromHeading;
  }
  for (const line of bodyMarkdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('[') && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return filename.replace(/\.md$/i, '');
}

export function speechTextForArticleDraft(bodyMarkdown: string): string {
  return replyTextForSpeechSynthesis(bodyMarkdown);
}

export function buildArticleDraftPagePayload(markdown: string, filename: string): ArticleDraftPagePayload {
  const body = stripDraftMetaHeader(markdown);
  return {
    file: filename,
    title: deriveArticleDraftTitle(body, filename),
    html: markdownToOperatorDocsHtml(body),
    speechText: speechTextForArticleDraft(body),
  };
}

export function computeArticleDraftsIndex(
  entries: ReadonlyArray<{ file: string; mtimeMs: number; markdown: string }>
): ArticleDraftsIndexPayload {
  const drafts = [...entries]
    .filter((entry) => isSafeArticleDraftFilename(entry.file))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => {
      const body = stripDraftMetaHeader(entry.markdown);
      return {
        file: entry.file,
        title: deriveArticleDraftTitle(body, entry.file),
        speechText: speechTextForArticleDraft(body),
      };
    });
  return { drafts };
}

export function articleDraftsRoutesAreReadOnly(
  methodsByPath: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  for (const routePath of ARTICLE_DRAFTS_READ_ROUTE_PATHS) {
    const methods = methodsByPath.get(routePath);
    if (!methods) {
      continue;
    }
    for (const method of methods) {
      if (writeMethods.has(method.toUpperCase())) {
        return false;
      }
    }
  }
  return true;
}
