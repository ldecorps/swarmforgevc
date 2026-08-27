#!/usr/bin/env node
/**
 * BL-1173: deprecator freshness gate. Coordinator consults this before every
 * paused→active promote. Prints {"decision":"allow"} or
 * {"decision":"hold","reason":"..."}. Never throws on missing inputs —
 * fail-closed is a hold result (same posture as BL-262 / onboarding-contract-gate).
 *
 * Usage: node deprecate-check.js <project-root> <BL-id>
 */
import * as fs from 'fs';
import * as path from 'path';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export type FreshnessDecision =
  | { decision: 'allow' }
  | { decision: 'hold'; reason: string };

export interface TicketFreshnessFacts {
  ticketId: string;
  yamlText: string;
  pausedPathExists: boolean;
  supersedeMarkerPath?: string;
  dependsOnIds: string[];
  dependsOnAllDone: boolean;
  doneClosureExists: boolean;
  retiredSurfaceHits: string[];
  specGapBounceCount: number;
}

const STALE_CLAIM_RE = /\b(superseded-by|superseded|retired|obsolete)\b/i;
const RETIRED_DOC_RE = /\bRETIRED\b/;

export function parseArgs(argv: string[]): { root: string; ticketId: string } | null {
  const [root, ticketId] = argv;
  if (!root || !ticketId) {
    return null;
  }
  return { root, ticketId };
}

export function normalizeTicketId(raw: string): string {
  const m = raw.trim().match(/^(BL-\d+)/i);
  return m ? m[1].toUpperCase() : raw.trim().toUpperCase();
}

function listYamlIds(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => normalizeTicketId(name.replace(/\.yaml$/, '').split('-').slice(0, 2).join('-')));
}

function findTicketYaml(root: string, ticketId: string, folder: 'paused' | 'active' | 'done'): string | undefined {
  const id = normalizeTicketId(ticketId);
  const base = path.join(root, 'backlog', folder);
  if (!fs.existsSync(base)) {
    return undefined;
  }
  const walk = (dir: string): string | undefined => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = walk(full);
        if (nested) {
          return nested;
        }
        continue;
      }
      if (entry.name.startsWith(id) && entry.name.endsWith('.yaml')) {
        return full;
      }
    }
    return undefined;
  };
  return walk(base);
}

export function parseDependsOn(yamlText: string): string[] {
  const match = yamlText.match(/^depends_on:\s*\[([^\]]*)\]/m);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => /^BL-\d+/i.test(part))
    .map(normalizeTicketId);
}

export function findSupersedeMarker(root: string, ticketId: string): string | undefined {
  const dir = path.join(root, '.swarmforge', 'superseded');
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  const id = normalizeTicketId(ticketId);
  const hit = fs.readdirSync(dir).find((name) => name === id || name.startsWith(`${id}-`));
  return hit ? path.join(dir, hit) : undefined;
}

function collectRetiredSurfaceHits(yamlText: string, retiredTokens: string[]): string[] {
  const hits: string[] = [];
  for (const token of retiredTokens) {
    if (token.length < 4) {
      continue;
    }
    if (yamlText.includes(token)) {
      hits.push(token);
    }
  }
  return hits;
}

export function loadRetiredTokens(root: string): string[] {
  const tokens = new Set<string>();
  const scanFile = (filePath: string) => {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      if (!RETIRED_DOC_RE.test(line)) {
        continue;
      }
      const pathLike = line.match(/[`'"\s]([A-Za-z0-9_./-]+\.(?:ts|js|bb|sh|md|prompt|conf))/);
      if (pathLike) {
        tokens.add(pathLike[1]);
      }
      const verb = line.match(/\b([a-z][a-z0-9_-]{2,})\b.*\bRETIRED\b/i);
      if (verb) {
        tokens.add(verb[1]);
      }
    }
  };
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(md|prompt|ts|bb|sh)$/.test(entry.name)) {
        scanFile(full);
      }
    }
  };
  walk(path.join(root, 'docs', 'deprecated'));
  walk(path.join(root, 'docs'));
  return [...tokens];
}

export function countSpecGapBounces(root: string, ticketId: string): number {
  const dir = path.join(root, '.swarmforge', 'bounces');
  if (!fs.existsSync(dir)) {
    return 0;
  }
  const id = normalizeTicketId(ticketId);
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.includes(id)) {
      continue;
    }
    try {
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      if (/spec-gap|spec_gap|acceptance/i.test(body) || /spec-gap/i.test(name)) {
        count += 1;
      }
    } catch {
      // unreadable bounce file: ignore for this signal
    }
  }
  return count;
}

export function gatherTicketFreshnessFacts(root: string, ticketId: string): TicketFreshnessFacts {
  const id = normalizeTicketId(ticketId);
  const pausedPath = findTicketYaml(root, id, 'paused');
  const activePath = findTicketYaml(root, id, 'active');
  const yamlPath = pausedPath ?? activePath;
  const yamlText = yamlPath ? fs.readFileSync(yamlPath, 'utf8') : '';
  const dependsOnIds = parseDependsOn(yamlText);
  const doneIds = new Set(listYamlIds(path.join(root, 'backlog', 'done')));
  // done/ is nested by milestone — also walk
  const doneWalk = (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        doneWalk(full);
      } else if (entry.name.endsWith('.yaml')) {
        doneIds.add(normalizeTicketId(entry.name.replace(/\.yaml$/, '').split('-').slice(0, 2).join('-')));
      }
    }
  };
  doneWalk(path.join(root, 'backlog', 'done'));

  const dependsOnAllDone =
    dependsOnIds.length > 0 && dependsOnIds.every((dep) => doneIds.has(dep) || findTicketYaml(root, dep, 'done'));

  return {
    ticketId: id,
    yamlText,
    pausedPathExists: Boolean(pausedPath),
    supersedeMarkerPath: findSupersedeMarker(root, id),
    dependsOnIds,
    dependsOnAllDone,
    doneClosureExists: Boolean(findTicketYaml(root, id, 'done')),
    retiredSurfaceHits: collectRetiredSurfaceHits(yamlText, loadRetiredTokens(root)),
    specGapBounceCount: countSpecGapBounces(root, id),
  };
}

function hold(reason: string): FreshnessDecision {
  return { decision: 'hold', reason };
}

export function evaluateDeprecatorFreshness(facts: TicketFreshnessFacts): FreshnessDecision {
  if (facts.supersedeMarkerPath) {
    return hold(`supersede marker present: ${facts.supersedeMarkerPath}`);
  }

  // Prefer the depends_on+RETIRED signal (Article 3.6 stale premise) over the
  // generic "claims retired" hold — same ticket text often matches both.
  if (facts.dependsOnAllDone && facts.retiredSurfaceHits.length > 0) {
    return hold(
      `stale premise: depends_on done but description still names retired surface(s): ${facts.retiredSurfaceHits.join(', ')}`
    );
  }

  if (facts.dependsOnAllDone && /\bRETIRED\b/.test(facts.yamlText)) {
    return hold('stale premise: depends_on done but ticket text still names RETIRED behaviour');
  }

  if (STALE_CLAIM_RE.test(facts.yamlText) && !facts.doneClosureExists) {
    return hold('ticket claims superseded/retired/obsolete without a backlog/done/ closure');
  }

  if (facts.specGapBounceCount >= 2) {
    return hold(`repeated spec-gap bounces (${facts.specGapBounceCount}) — premise may be obsolete`);
  }

  return { decision: 'allow' };
}

export function deprecateCheck(root: string, ticketId: string): FreshnessDecision {
  return evaluateDeprecatorFreshness(gatherTicketFreshnessFacts(root, ticketId));
}

function parseFreshnessJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decisionFromParsed(parsed: unknown): FreshnessDecision | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const decision = (parsed as { decision?: unknown }).decision;
  const reason = (parsed as { reason?: unknown }).reason;
  if (decision === 'allow') {
    return { decision: 'allow' };
  }
  if (decision === 'hold') {
    return hold(typeof reason === 'string' && reason.length > 0 ? reason : 'hold without reason — fail closed');
  }
  return null;
}

/**
 * Pure fail-closed interpreter for promote_and_route_next.sh's CLI consult.
 * Empty, unparseable, or non-allow/hold shapes never become allow (BL-1173 inv 1).
 */
export function interpretFreshnessCliOutput(raw: string | null | undefined): FreshnessDecision {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return hold('empty deprecate-check output — fail closed');
  }
  const parsed = parseFreshnessJson(String(raw));
  if (parsed === null) {
    return hold('malformed deprecate-check output — fail closed');
  }
  return decisionFromParsed(parsed) ?? hold('malformed deprecate-check output — fail closed');
}

/**
 * Article 3.6 / BL-1173 inv 2: expedite eligibility never overrides a freshness hold.
 */
export function mayPromoteGivenFreshness(
  decision: FreshnessDecision,
  _expediteEligible: boolean
): boolean {
  return decision.decision === 'allow';
}

/**
 * BL-1173 inv 3: on hold the ticket stays paused and the specifier must be notified.
 */
export function holdPromoteSideEffects(decision: FreshnessDecision): {
  staysPaused: boolean;
  notifySpecifierPriority00: boolean;
} {
  if (decision.decision === 'hold') {
    return { staysPaused: true, notifySpecifierPriority00: true };
  }
  return { staysPaused: false, notifySpecifierPriority00: false };
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node deprecate-check.js <project-root> <BL-id>\n',
  async ({ root, ticketId }) => {
    printJsonToStdout(deprecateCheck(root, ticketId));
  }
);

if (require.main === module) {
  runCliMain(main);
}
