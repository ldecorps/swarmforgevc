// BL-696 amendment: render an agent reply for Telegram. Telegram has no table
// markup, so a markdown grid becomes an aligned monospace <pre> block — or,
// when it cannot fit a portrait phone, one labelled block per row. Emphasis,
// inline code, links and fenced code become the small HTML subset Telegram's
// parse_mode understands. Pure text decisions; the adapter owns the send.
import { TELEGRAM_MESSAGE_MAX_LENGTH } from '../tools/telegramCursorBridgeCore';

// Portrait-phone budget for a monospace row (matches the pipeline board's own
// "fits without horizontal scroll" posture). A wider grid stacks instead.
export const TELEGRAM_GRID_MAX_WIDTH = 48;

const COLUMN_SEPARATOR = ' | ';
const RULE_JOINT = '-+-';
const PRE_OPEN = '<pre>';
const PRE_CLOSE = '</pre>';

/** A grid with no header row carries `header: []` — a key/value grid. */
export interface MarkdownGrid {
  header: string[];
  rows: string[][];
}

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inverse of the render, for the adapter's plain-text fallback. */
export function telegramHtmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripInlineMarkdownMarkers(text: string): string {
  return text.replace(/\*\*|__|~~|[*`]/g, '');
}

export function parseMarkdownGridRow(line: string): string[] | undefined {
  if (!line.includes('|')) {
    return undefined;
  }
  let inner = line.trim();
  if (inner.startsWith('|')) {
    inner = inner.slice(1);
  }
  if (inner.endsWith('|')) {
    inner = inner.slice(0, -1);
  }
  return inner.split('|').map((cell) => cell.trim());
}

/** GFM allows one dash per column, so `|--|--|` and `|-|-|` both rule a grid. */
export function isMarkdownGridSeparatorRow(line: string): boolean {
  const cells = parseMarkdownGridRow(line);
  if (cells === undefined) {
    return false;
  }
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function normalizeGridRow(cells: string[], width: number): string[] {
  const padded = [...cells];
  while (padded.length < width) {
    padded.push('');
  }
  return padded;
}

/** Cells of a header/body row — a separator row is structure, not content. */
function parseGridContentRow(line: string): string[] | undefined {
  if (isMarkdownGridSeparatorRow(line)) {
    return undefined;
  }
  return parseMarkdownGridRow(line);
}

function takeGridBodyRows(lines: string[], start: number): { cells: string[][]; next: number } {
  const cells: string[][] = [];
  for (const line of lines.slice(start)) {
    const row = parseGridContentRow(line);
    if (row === undefined) {
      break;
    }
    cells.push(row);
  }
  return { cells, next: start + cells.length };
}

function gridHeaderRow(headerCells: string[], width: number): string[] {
  return headerCells.some((cell) => cell.length > 0) ? normalizeGridRow(headerCells, width) : [];
}

export function takeMarkdownGrid(
  lines: string[],
  start: number
): { grid: MarkdownGrid; next: number } | undefined {
  if (start + 1 >= lines.length) {
    return undefined;
  }
  const headerCells = parseGridContentRow(lines[start]);
  if (headerCells === undefined || !isMarkdownGridSeparatorRow(lines[start + 1])) {
    return undefined;
  }
  const body = takeGridBodyRows(lines, start + 2);
  const width = Math.max(headerCells.length, ...body.cells.map((cells) => cells.length));
  return {
    grid: {
      header: gridHeaderRow(headerCells, width),
      rows: body.cells.map((cells) => normalizeGridRow(cells, width)),
    },
    next: body.next,
  };
}

function gridCellText(cell: string): string {
  return stripInlineMarkdownMarkers(cell).trim();
}

function columnWidths(grid: MarkdownGrid): number[] {
  // An absent header is an empty row here, so it widens nothing.
  const allRows = [grid.header, ...grid.rows];
  const width = allRows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const widths: number[] = [];
  for (let column = 0; column < width; column += 1) {
    widths.push(
      allRows.reduce((widest, row) => Math.max(widest, gridCellText(row[column] ?? '').length), 0)
    );
  }
  return widths;
}

// Telegram HTML collapses a run of leading spaces inside <pre>, which would
// left-flush an empty first cell against the next column.
function protectLeadingSpaces(text: string): string {
  const leading = text.length - text.replace(/^ +/, '').length;
  return '\u00a0'.repeat(leading) + text.slice(leading);
}

function renderGridLine(row: string[], widths: number[]): string {
  const cells = widths.map((width, column) => {
    const padded = gridCellText(row[column] ?? '').padEnd(width, ' ');
    return column === 0 ? protectLeadingSpaces(padded) : padded;
  });
  // Trailing empty cells leave a dangling separator; a cell can never contain
  // a pipe of its own, so trimming both is safe.
  return cells.join(COLUMN_SEPARATOR).replace(/[ \u00a0|]+$/, '');
}

export function renderGridAsMonospace(grid: MarkdownGrid): string {
  const widths = columnWidths(grid);
  const lines: string[] = [];
  if (grid.header.length > 0) {
    lines.push(renderGridLine(grid.header, widths));
    lines.push(widths.map((width) => '-'.repeat(width)).join(RULE_JOINT));
  }
  for (const row of grid.rows) {
    lines.push(renderGridLine(row, widths));
  }
  return lines.join('\n');
}

export function gridWidth(grid: MarkdownGrid): number {
  return renderGridAsMonospace(grid)
    .split('\n')
    .reduce((widest, line) => Math.max(widest, line.length), 0);
}

function stackedCellLine(cell: string, headerCell: string): string | undefined {
  const value = gridCellText(cell);
  if (!value) {
    return undefined;
  }
  const label = gridCellText(headerCell);
  const valueHtml = escapeTelegramHtml(value);
  return label ? `${escapeTelegramHtml(label)}: ${valueHtml}` : valueHtml;
}

function stackedRowLines(row: string[], header: string[]): string[] {
  const lines = [`<b>${escapeTelegramHtml(gridCellText(row[0] ?? ''))}</b>`];
  row.slice(1).forEach((cell, offset) => {
    const line = stackedCellLine(cell, header[offset + 1] ?? '');
    if (line !== undefined) {
      lines.push(line);
    }
  });
  return lines;
}

/** One block per row: the first cell titles it, the rest are labelled by header. */
export function renderGridAsStackedHtml(grid: MarkdownGrid): string {
  return grid.rows.map((row) => stackedRowLines(row, grid.header).join('\n')).join('\n\n');
}

export function renderMarkdownGridHtml(grid: MarkdownGrid, maxWidth = TELEGRAM_GRID_MAX_WIDTH): string {
  if (gridWidth(grid) <= maxWidth) {
    return `${PRE_OPEN}${escapeTelegramHtml(renderGridAsMonospace(grid))}${PRE_CLOSE}`;
  }
  return renderGridAsStackedHtml(grid);
}

function convertEmphasis(escaped: string): string {
  return escaped
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function inlineMarkdownToTelegramHtml(text: string): string {
  const parts: string[] = [];
  const codeSpan = /`([^`]+)`/g;
  let cursor = 0;
  let match = codeSpan.exec(text);
  while (match !== null) {
    parts.push(convertEmphasis(escapeTelegramHtml(text.slice(cursor, match.index))));
    parts.push(`<code>${escapeTelegramHtml(match[1])}</code>`);
    cursor = match.index + match[0].length;
    match = codeSpan.exec(text);
  }
  parts.push(convertEmphasis(escapeTelegramHtml(text.slice(cursor))));
  return parts.join('');
}

function takeFencedCodeBlock(lines: string[], start: number): { html: string; next: number } {
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !/^\s*```/.test(lines[index])) {
    body.push(lines[index]);
    index += 1;
  }
  return {
    html: `${PRE_OPEN}${escapeTelegramHtml(body.join('\n'))}${PRE_CLOSE}`,
    next: index + 1,
  };
}

export function markdownToTelegramHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      const fenced = takeFencedCodeBlock(lines, index);
      out.push(fenced.html);
      index = fenced.next;
      continue;
    }
    const grid = takeMarkdownGrid(lines, index);
    if (grid) {
      out.push(renderMarkdownGridHtml(grid.grid));
      index = grid.next;
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.*)/);
    if (heading) {
      out.push(`<b>${inlineMarkdownToTelegramHtml(heading[1])}</b>`);
      index += 1;
      continue;
    }
    // A thematic break has no Telegram equivalent; dropping it beats posting
    // a row of raw dashes the reader has to mentally skip.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      index += 1;
      continue;
    }
    out.push(inlineMarkdownToTelegramHtml(line));
    index += 1;
  }
  return out.join('\n');
}

// A formatting rejection (Telegram's "can't parse entities" family, or any
// other 4xx that is not rate limiting) is worth retrying as plain text: the
// reply still reaches the principal. A transient failure is NOT — the retry
// would race the send that may still land and post the reply twice.
const TRANSIENT_SEND_FAILURE =
  /\b(429|5\d\d)\b|too many requests|retry after|rate limit|timed? ?out|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i;

/** A failure with no description is treated as a formatting one, so it retries. */
export function shouldRetryTelegramPostAsPlainText(error: string | undefined): boolean {
  return !TRANSIENT_SEND_FAILURE.test(String(error));
}

interface HtmlBlock {
  text: string;
  pre: boolean;
}

function takePreBlock(lines: string[], start: number): { text: string; next: number } {
  const collected: string[] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    collected.push(lines[index]);
    if (lines[index].includes(PRE_CLOSE)) {
      index += 1;
      break;
    }
  }
  return { text: collected.join('\n'), next: index };
}

// A <pre> block is atomic: chunking may never cut one open, so it travels as
// one block however many lines it spans.
function splitHtmlBlocks(html: string): HtmlBlock[] {
  const lines = html.split('\n');
  const blocks: HtmlBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].startsWith(PRE_OPEN)) {
      const block = takePreBlock(lines, index);
      blocks.push({ text: block.text, pre: true });
      index = block.next;
      continue;
    }
    blocks.push({ text: lines[index], pre: false });
    index += 1;
  }
  return blocks;
}

function hardSplit(text: string, maxLen: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest !== '') {
    parts.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  return parts;
}

function preInnerLines(block: string): string[] {
  const withoutOpen = block.startsWith(PRE_OPEN) ? block.slice(PRE_OPEN.length) : block;
  const inner = withoutOpen.endsWith(PRE_CLOSE)
    ? withoutOpen.slice(0, withoutOpen.length - PRE_CLOSE.length)
    : withoutOpen;
  return inner.split('\n');
}

// Groups of lines that each fit maxLen once `overhead` (the wrapper tags) is
// counted. A single line longer than the budget stays whole and overflows —
// breaking it would corrupt the markup around it.
function groupLinesWithinLimit(lines: string[], maxLen: number, overhead: number): string[][] {
  const groups: string[][] = [[]];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    const candidate = [...current, line].join('\n');
    if (current.length === 0 || candidate.length + overhead <= maxLen) {
      current.push(line);
      continue;
    }
    groups.push([line]);
  }
  return groups;
}

function splitOversizedPre(block: string, maxLen: number): string[] {
  return groupLinesWithinLimit(preInnerLines(block), maxLen, PRE_OPEN.length + PRE_CLOSE.length).map(
    (group) => `${PRE_OPEN}${group.join('\n')}${PRE_CLOSE}`
  );
}

interface ChunkAccumulator {
  chunks: string[];
  current: string;
}

function joinWithinLimit(current: string, text: string, maxLen: number): string | undefined {
  const candidate = current === '' ? text : `${current}\n${text}`;
  return candidate.length <= maxLen ? candidate : undefined;
}

function splitBlockToChunks(block: HtmlBlock, maxLen: number): string[] {
  return block.pre ? splitOversizedPre(block.text, maxLen) : hardSplit(block.text, maxLen);
}

function accumulateBlock(state: ChunkAccumulator, block: HtmlBlock, maxLen: number): ChunkAccumulator {
  const joined = joinWithinLimit(state.current, block.text, maxLen);
  if (joined !== undefined) {
    return { chunks: state.chunks, current: joined };
  }
  const flushed = state.current === '' ? state.chunks : [...state.chunks, state.current];
  const parts = splitBlockToChunks(block, maxLen);
  return { chunks: [...flushed, ...parts.slice(0, -1)], current: parts[parts.length - 1] ?? '' };
}

/** Chunk rendered HTML for Telegram without ever cutting a <pre> block open. */
export function splitTelegramHtmlChunks(html: string, maxLen: number = TELEGRAM_MESSAGE_MAX_LENGTH): string[] {
  const state = splitHtmlBlocks(html).reduce<ChunkAccumulator>(
    (acc, block) => accumulateBlock(acc, block, maxLen),
    { chunks: [], current: '' }
  );
  return state.current === '' ? state.chunks : [...state.chunks, state.current];
}
