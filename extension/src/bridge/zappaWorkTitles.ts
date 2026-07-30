import type { ProgressLocale } from './progressLocale';
import { ZAPPA_WORK_TITLES } from './zappaWorkTitlesData';

export function stableIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return mod > 0 ? hash % mod : 0;
}

export function pickZappaWorkTitle(seed: string): string {
  return ZAPPA_WORK_TITLES[stableIndex(seed.toLowerCase(), ZAPPA_WORK_TITLES.length)];
}

function slugifyTitle(title: string): string {
  return title
    .replace(/^The\s+/i, '')
    .replace(/, The$/i, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function shortToolName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= 20 ? trimmed : `${trimmed.slice(0, 17)}…`;
}

export function zappaPhraseForTool(
  toolName: string,
  locale: ProgressLocale,
  phase: 'running' | 'completed' | 'error'
): string {
  const title = pickZappaWorkTitle(toolName);
  const slug = slugifyTitle(title);
  const tool = shortToolName(toolName);

  if (locale === 'fr') {
    if (phase === 'running') {
      return `${slug}-ise «${tool}»`;
    }
    if (phase === 'completed') {
      return `${title} — «${tool}» bouclé`;
    }
    return `stink-foot sur «${tool}» (${title})`;
  }

  if (phase === 'running') {
    return `${slug}-ing «${tool}»`;
  }
  if (phase === 'completed') {
    return `${title} wrapped «${tool}»`;
  }
  return `cosmik debris on «${tool}» (${title})`;
}
