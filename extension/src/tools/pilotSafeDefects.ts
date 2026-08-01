/**
 * BL-722: pure filter + rank for `/pilot safe` — approved, low-mutation,
 * specced defects in paused/ (default), never needs_design.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type SafePilotDefect = {
  id: string;
  title: string;
  severity: string;
  priority: number;
  mutationCost: string;
  fileName: string;
};

export type SafePilotListResult = {
  tickets: SafePilotDefect[];
  reasonEmpty?: string;
};

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function readYamlFront(filePath: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(raw);
    return doc && typeof doc === 'object' && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function asPriority(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = asString(v);
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 999;
}

function featureExists(repoRoot: string, id: string, acceptance: string): boolean {
  if (acceptance && acceptance.endsWith('.feature') && !acceptance.endsWith('.feature.draft')) {
    const abs = path.isAbsolute(acceptance) ? acceptance : path.join(repoRoot, acceptance);
    if (fs.existsSync(abs)) return true;
  }
  const dir = path.join(repoRoot, 'specs', 'features');
  if (!fs.existsSync(dir)) return false;
  const prefix = `${id}-`;
  try {
    return fs.readdirSync(dir).some((name) => {
      if (!name.endsWith('.feature') || name.endsWith('.feature.draft')) return false;
      return name === `${id}.feature` || name.startsWith(prefix);
    });
  } catch {
    return false;
  }
}

function normalizeId(id: string): string {
  const m = id.trim().match(/^(BL|GH)-(\d+)$/i);
  if (!m) return id.trim().toUpperCase();
  return `${m[1].toUpperCase()}-${m[2]}`;
}

export function listSafePilotDefects(
  repoRoot: string,
  opts?: { folder?: 'paused' | 'active' | 'paused+active' }
): SafePilotListResult {
  const folderMode = opts?.folder ?? 'paused';
  const folders =
    folderMode === 'paused+active' ? (['paused', 'active'] as const) : ([folderMode] as const);
  const tickets: SafePilotDefect[] = [];
  for (const folder of folders) {
    const dir = path.join(repoRoot, 'backlog', folder);
    if (!fs.existsSync(dir)) continue;
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith('.yaml')) continue;
      const full = path.join(dir, fileName);
      const doc = readYamlFront(full);
      if (!doc) continue;
      if (asString(doc.type) !== 'defect') continue;
      if (asString(doc.status) === 'needs_design') continue;
      if (asString(doc.human_approval) !== 'approved') continue;
      if (asString(doc.mutation_cost) !== 'low') continue;
      const id = normalizeId(asString(doc.id));
      if (!id) continue;
      const acceptance = asString(doc.acceptance);
      if (!featureExists(repoRoot, id, acceptance)) continue;
      tickets.push({
        id,
        title: asString(doc.title) || id,
        severity: asString(doc.severity) || 'unset',
        priority: asPriority(doc.priority),
        mutationCost: 'low',
        fileName: `${folder}/${fileName}`,
      });
    }
  }
  tickets.sort((a, b) => {
    const sa = SEV_RANK[a.severity] ?? 9;
    const sb = SEV_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });
  if (tickets.length === 0) {
    return {
      tickets: [],
      reasonEmpty:
        'No paused defects match safe filter (type=defect, approved, mutation_cost=low, not needs_design, real .feature).',
    };
  }
  return { tickets };
}

export function pickSafePilotDefect(
  repoRoot: string,
  opts?: { folder?: 'paused' | 'active' | 'paused+active' }
): { ticket: SafePilotDefect; rationale: string } | { empty: true; reason: string } {
  const listed = listSafePilotDefects(repoRoot, opts);
  if (listed.tickets.length === 0) {
    return { empty: true, reason: listed.reasonEmpty || 'Safe pilot pool is empty.' };
  }
  const ticket = listed.tickets[0];
  const rationale = [
    `Safe filter matched ${listed.tickets.length} ticket(s).`,
    `Picked ${ticket.id} (severity=${ticket.severity}, priority=${ticket.priority}, mutation_cost=low, approved, specced).`,
    `Title: ${ticket.title}`,
  ].join(' ');
  return { ticket, rationale };
}

export function formatSafePilotListMessage(result: SafePilotListResult): string {
  if (result.tickets.length === 0) {
    return `Safe pilot pool empty.\n${result.reasonEmpty || ''}`.trim();
  }
  const lines = [
    `Safe pilot pool (${result.tickets.length}) — defect + approved + mutation_cost=low + specced + not needs_design:`,
    ...result.tickets.map(
      (t, i) =>
        `${i + 1}. ${t.id} sev=${t.severity} pri=${t.priority} — ${t.title.slice(0, 80)}`
    ),
    '',
    'Start top: /pilot safe',
    'Or explicit: /pilot BL-xxx',
  ];
  return lines.join('\n');
}
