// Shared hold-music chiptune catalog for Mini App + Android companion.
// Source of truth: letsTalkChiptunes.json (MIDI step loops).
// Serve via GET /lets-talk/chiptunes.json so phones pick up new songs
// without an APK rebuild.

import catalogJson from './letsTalkChiptunes.json';

export type LetsTalkChiptuneSong = {
  name: string;
  bpm: number;
  /** [pulse1, pulse2, triangle, hat] MIDI notes; 0 = rest. hat: 0/1/2 */
  steps: number[][];
};

export type LetsTalkChiptunesCatalog = {
  version: number;
  format: string;
  description?: string;
  songs: LetsTalkChiptuneSong[];
};

const catalog = catalogJson as LetsTalkChiptunesCatalog;

export function getLetsTalkChiptunesCatalog(): LetsTalkChiptunesCatalog {
  return catalog;
}

/** Stable JSON body for HTTP (no pretty-print; clients parse either way). */
export function getLetsTalkChiptunesJsonBody(): string {
  return JSON.stringify(catalog);
}

export function isLetsTalkChiptunesPath(url: string): boolean {
  const path = url.split('?', 1)[0];
  return path === '/lets-talk/chiptunes.json' || path === '/lets-talk/chiptunes';
}
