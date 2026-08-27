// BL-1166: pure helpers for Operator docs — parse docs/index.md Divio
// sections and render authored markdown as phone-readable HTML.
import { DIVIO_MODES, type DivioMode } from '../docs/docsStructure';

export interface DocsIndexLink {
  title: string;
  path: string;
}

export interface DocsIndexSection {
  mode: DivioMode;
  heading: string;
  links: DocsIndexLink[];
}

export interface OperatorDocsIndexPayload {
  sections: DocsIndexSection[];
}

export interface OperatorDocsPagePayload {
  title: string;
  html: string;
  path: string;
}

export const OPERATOR_DOCS_READ_ROUTE_PATHS = [
  '/operator-docs',
  '/operator-docs-index',
  '/operator-docs-page',
] as const;

const LINK_PATTERN = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:—|--|-)?/;

function findModeHeadingLineIndex(lines: string[], mode: DivioMode): number {
  const headingPattern = new RegExp(`^#{1,6}\\s.*\\b${mode}\\b`, 'i');
  return lines.findIndex((line) => headingPattern.test(line));
}

function decodeMarkdownPath(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath.trim());
  } catch {
    return rawPath.trim();
  }
}

function parseLinksFromSection(sectionText: string): DocsIndexLink[] {
  const links: DocsIndexLink[] = [];
  for (const line of sectionText.split('\n')) {
    const match = LINK_PATTERN.exec(line.trim());
    if (!match) {
      continue;
    }
    links.push({ title: match[1].trim(), path: decodeMarkdownPath(match[2]) });
  }
  return links;
}

function sliceSectionText(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine + 1, endLine).join('\n');
}

export function parseDocsIndexSections(indexContent: string): DocsIndexSection[] {
  const lines = indexContent.split('\n');
  const headingLines = DIVIO_MODES.map((mode) => ({
    mode,
    lineIndex: findModeHeadingLineIndex(lines, mode),
  })).filter((entry) => entry.lineIndex >= 0);

  return headingLines.map((entry, index) => {
    const nextLine = index + 1 < headingLines.length ? headingLines[index + 1].lineIndex : lines.length;
    return {
      mode: entry.mode,
      heading: lines[entry.lineIndex].replace(/^#{1,6}\s*/, '').trim(),
      links: parseLinksFromSection(sliceSectionText(lines, entry.lineIndex, nextLine)),
    };
  });
}

export function computeOperatorDocsIndex(indexContent: string): OperatorDocsIndexPayload {
  return { sections: parseDocsIndexSections(indexContent) };
}

export function isSafeDocsRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('..')) {
    return false;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized.length > 0 && !normalized.startsWith('..') && !normalized.includes('/../');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+/.exec(line);
  return match ? match[1].length : null;
}

function flushParagraph(buffer: string[], out: string[]): void {
  if (buffer.length === 0) {
    return;
  }
  out.push(`<p>${renderInlineMarkdown(buffer.join(' '))}</p>`);
  buffer.length = 0;
}

function flushList(items: string[], out: string[]): void {
  if (items.length === 0) {
    return;
  }
  out.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
  items.length = 0;
}

function flushCodeBlock(lines: string[], out: string[]): void {
  if (lines.length === 0) {
    return;
  }
  out.push(`<pre><code>${escapeHtml(lines.join('\n'))}</code></pre>`);
  lines.length = 0;
}

export function markdownToOperatorDocsHtml(markdown: string): string {
  const out: string[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  const codeLines: string[] = [];
  let inCode = false;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().startsWith('```')) {
      flushParagraph(paragraph, out);
      flushList(listItems, out);
      if (inCode) {
        flushCodeBlock(codeLines, out);
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const level = headingLevel(line);
    if (level !== null) {
      flushParagraph(paragraph, out);
      flushList(listItems, out);
      const tag = `h${Math.min(level, 3)}`;
      out.push(`<${tag}>${renderInlineMarkdown(line.slice(level + 1).trim())}</${tag}>`);
      continue;
    }

    if (/^-\s+/.test(line.trim())) {
      flushParagraph(paragraph, out);
      listItems.push(line.trim().replace(/^-\s+/, ''));
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(paragraph, out);
      flushList(listItems, out);
      continue;
    }

    flushList(listItems, out);
    paragraph.push(line.trim());
  }

  flushParagraph(paragraph, out);
  flushList(listItems, out);
  if (inCode) {
    flushCodeBlock(codeLines, out);
  }
  return out.join('\n');
}

export function deriveDocTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split('\n')) {
    const level = headingLevel(line);
    if (level !== null) {
      return line.slice(level + 1).trim();
    }
  }
  return fallback;
}

export function buildOperatorDocsPagePayload(markdown: string, docPath: string): OperatorDocsPagePayload {
  const fileName = docPath.split('/').pop() ?? docPath;
  return {
    path: docPath,
    title: deriveDocTitle(markdown, fileName.replace(/\.md$/i, '')),
    html: markdownToOperatorDocsHtml(markdown),
  };
}

export function operatorDocsRoutesAreReadOnly(methodsByPath: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  for (const routePath of OPERATOR_DOCS_READ_ROUTE_PATHS) {
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
