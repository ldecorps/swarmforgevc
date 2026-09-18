// BL-1153: durable Mini App font-size preferences under .swarmforge/operator/.
// Architecture Rule 3: Mini Apps persist via the bridge host, never webview
// localStorage/sessionStorage. PWA dashboard keeps its own Cache preference.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import {
  PANE_FONT_DEFAULT_PX,
  PANE_FONT_MAX_PX,
  PANE_FONT_MIN_PX,
  clampPaneFontSizePx,
} from './residentSpyPaneFontSize';

export type WebUiFontSizeSurface = 'live-screen' | 'pipeline-grid' | 'paused-pager';

export const WEB_UI_FONT_SIZE_SURFACES: WebUiFontSizeSurface[] = [
  'live-screen',
  'pipeline-grid',
  'paused-pager',
];

export interface WebUiFontSizeBounds {
  min: number;
  max: number;
  default: number;
}

export const WEB_UI_FONT_SIZE_BOUNDS: Record<WebUiFontSizeSurface, WebUiFontSizeBounds> = {
  'live-screen': { min: PANE_FONT_MIN_PX, max: PANE_FONT_MAX_PX, default: PANE_FONT_DEFAULT_PX },
  'pipeline-grid': { min: 12, max: 26, default: 15 },
  'paused-pager': { min: 12, max: 26, default: 15 },
};

export function isWebUiFontSizeSurface(value: unknown): value is WebUiFontSizeSurface {
  return typeof value === 'string' && (WEB_UI_FONT_SIZE_SURFACES as string[]).includes(value);
}

export function webUiFontSizePreferencePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'web-ui-font-size-preferences.json');
}

function clampForSurface(surface: WebUiFontSizeSurface, px: number): number {
  if (surface === 'live-screen') {
    return clampPaneFontSizePx(px);
  }
  const bounds = WEB_UI_FONT_SIZE_BOUNDS[surface];
  if (!Number.isFinite(px)) {
    return bounds.default;
  }
  if (px < bounds.min) {
    return bounds.min;
  }
  if (px > bounds.max) {
    return bounds.max;
  }
  return Math.round(px);
}

export type WebUiFontSizePreferenceRead =
  | { kind: 'stored'; fontSizePx: number }
  | { kind: 'none' }
  | { kind: 'unreadable' };

function readPreferenceMap(targetPath: string): Record<string, unknown> | null {
  const filePath = webUiFontSizePreferencePath(targetPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readWebUiFontSizePreference(
  targetPath: string,
  surface: WebUiFontSizeSurface
): WebUiFontSizePreferenceRead {
  const map = readPreferenceMap(targetPath);
  if (map === null) {
    return fs.existsSync(webUiFontSizePreferencePath(targetPath)) ? { kind: 'unreadable' } : { kind: 'none' };
  }
  const raw = map[surface];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { kind: 'none' };
  }
  return { kind: 'stored', fontSizePx: clampForSurface(surface, raw) };
}

export function resolveWebUiFontSizePx(targetPath: string, surface: WebUiFontSizeSurface): number {
  const preference = readWebUiFontSizePreference(targetPath, surface);
  if (preference.kind === 'stored') {
    return preference.fontSizePx;
  }
  return WEB_UI_FONT_SIZE_BOUNDS[surface].default;
}

export type WebUiFontSizePreferenceWrite = { ok: true; fontSizePx: number } | { ok: false; reason: string };

// BL-1542: the collapsed/expanded state of the live screen's ticket strip,
// one boolean per surface, stored BESIDE fontSizePx in the same file (a
// sibling top-level key, "ticketStripCollapsed") - one store, not a second
// file. Every write below preserves the OTHER section unread by that write
// (font-size writes keep ticketStripCollapsed intact, and vice versa) so
// the two preferences never clobber each other.
function readTicketStripCollapsedMap(existing: Record<string, unknown> | null): Record<string, boolean> {
  const raw = existing ? existing.ticketStripCollapsed : undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const key of WEB_UI_FONT_SIZE_SURFACES) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function readFontSizeMap(existing: Record<string, unknown> | null): Record<string, number> {
  const next: Record<string, number> = {};
  if (existing) {
    for (const key of WEB_UI_FONT_SIZE_SURFACES) {
      const raw = existing[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        next[key] = clampForSurface(key, raw);
      }
    }
  }
  return next;
}

export function writeWebUiFontSizePreference(
  targetPath: string,
  surface: WebUiFontSizeSurface,
  fontSizePx: number
): WebUiFontSizePreferenceWrite {
  if (!Number.isFinite(fontSizePx)) {
    return { ok: false, reason: 'fontSizePx must be a finite number' };
  }
  const clamped = clampForSurface(surface, fontSizePx);
  const existing = readPreferenceMap(targetPath);
  const next: Record<string, unknown> = readFontSizeMap(existing);
  next[surface] = clamped;
  const collapsedMap = readTicketStripCollapsedMap(existing);
  if (Object.keys(collapsedMap).length > 0) {
    next.ticketStripCollapsed = collapsedMap;
  }
  atomicWrite(webUiFontSizePreferencePath(targetPath), JSON.stringify(next));
  return { ok: true, fontSizePx: clamped };
}

export function isWebUiFontSizeWriteRequestShape(
  value: unknown
): value is { surface: WebUiFontSizeSurface; fontSizePx: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isWebUiFontSizeSurface(record.surface) &&
    typeof record.fontSizePx === 'number' &&
    Number.isFinite(record.fontSizePx)
  );
}

export type WebUiTicketStripCollapsedRead =
  | { kind: 'stored'; collapsed: boolean }
  | { kind: 'none' }
  | { kind: 'unreadable' };

export function readWebUiTicketStripCollapsed(
  targetPath: string,
  surface: WebUiFontSizeSurface
): WebUiTicketStripCollapsedRead {
  const map = readPreferenceMap(targetPath);
  if (map === null) {
    return fs.existsSync(webUiFontSizePreferencePath(targetPath)) ? { kind: 'unreadable' } : { kind: 'none' };
  }
  const collapsedMap = readTicketStripCollapsedMap(map);
  if (!(surface in collapsedMap)) {
    return { kind: 'none' };
  }
  return { kind: 'stored', collapsed: collapsedMap[surface] };
}

export function resolveWebUiTicketStripCollapsed(targetPath: string, surface: WebUiFontSizeSurface): boolean {
  const preference = readWebUiTicketStripCollapsed(targetPath, surface);
  return preference.kind === 'stored' ? preference.collapsed : false;
}

export type WebUiTicketStripCollapsedWrite = { ok: true; collapsed: boolean } | { ok: false; reason: string };

export function writeWebUiTicketStripCollapsed(
  targetPath: string,
  surface: WebUiFontSizeSurface,
  collapsed: boolean
): WebUiTicketStripCollapsedWrite {
  if (typeof collapsed !== 'boolean') {
    return { ok: false, reason: 'collapsed must be a boolean' };
  }
  const existing = readPreferenceMap(targetPath);
  const next: Record<string, unknown> = readFontSizeMap(existing);
  const collapsedMap = readTicketStripCollapsedMap(existing);
  collapsedMap[surface] = collapsed;
  next.ticketStripCollapsed = collapsedMap;
  atomicWrite(webUiFontSizePreferencePath(targetPath), JSON.stringify(next));
  return { ok: true, collapsed };
}

export function isWebUiTicketStripCollapsedWriteRequestShape(
  value: unknown
): value is { surface: WebUiFontSizeSurface; collapsed: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isWebUiFontSizeSurface(record.surface) && typeof record.collapsed === 'boolean';
}
