import * as fs from 'fs';
import * as path from 'path';

import type { StaleItem } from './types';

const CONFIG_LINE_RE = /^config\s+(\S+)\b/gm;

/** Collect `config NAME` keys from swarmforge.conf text. */
export function parseConfFlagNames(confText: string): string[] {
  const names: string[] = [];
  for (const m of confText.matchAll(CONFIG_LINE_RE)) {
    names.push(m[1]);
  }
  return names;
}

/**
 * A flag is an orphan when its name appears only in the conf file itself
 * (no other tree hit). Inject `nameHits` for tests.
 */
export function orphanConfSignals(
  confText: string,
  nameHits: (flag: string) => number
): StaleItem[] {
  const out: StaleItem[] = [];
  for (const name of parseConfFlagNames(confText)) {
    const hits = nameHits(name);
    if (hits > 1) continue;
    out.push({
      subject: name,
      kind: 'orphan-conf-flag',
      recurrence: 1,
      blastRadius: 1,
      adjudication: 'retire',
      estimatedFiles: 2,
      estimatedLines: 12,
    });
  }
  return out;
}

function countNameHits(root: string, flag: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'out') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let text: string;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (text.includes(flag)) count += 1;
    }
  };
  walk(root);
  return count;
}

export function scanOrphanConfFlags(root: string, confRel = 'swarmforge/swarmforge.conf'): StaleItem[] {
  const confPath = path.join(root, confRel);
  if (!fs.existsSync(confPath)) return [];
  const confText = fs.readFileSync(confPath, 'utf8');
  return orphanConfSignals(confText, (flag) => countNameHits(root, flag));
}
