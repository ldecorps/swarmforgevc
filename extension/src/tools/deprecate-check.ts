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

// BL-1268: the generic-claim branch used to hold whenever STALE_CLAIM_RE
// matched ANYWHERE in the candidate's YAML, so a notes line correctly citing
// another ticket's disposition — exactly where such cross-references belong —
// read as a stale premise about this ticket. Measured over the live paused
// pool that was a fifth of the whole pool, including every ticket carrying a
// recorded adjudication, so writing an adjudication down made its own hold
// permanent. The branch now fires only on a claim about THIS ticket: a
// structured disposition field, or a claim word bound to a self-reference in
// the same sentence. Prose naming another ticket is not a claim about this one.

/** Top-level YAML fields whose value IS this ticket's own disposition. */
const SELF_DISPOSITION_FIELDS = [
  'status',
  'closed_as',
  'closed_by',
  'superseded_by',
  'retired_by',
  'obsoleted_by',
  'deprecated_by',
  'disposition',
];

/** Phrases that make this ticket the subject of the sentence they open. */
const SELF_SUBJECT_RE =
  /\bthis (?:ticket|one|item|slice|spec|parcel)\b|\bthis (?:is|was|has been|had been|will be)\b|\bthe ticket itself\b/gi;

/**
 * How far a claim word may sit from the self-reference it is predicated on.
 * Wide enough for "this ticket is, on the current reading, superseded"; too
 * narrow for a second clause about something else entirely.
 */
const SELF_CLAIM_PREDICATE_WINDOW = 40;

/** Phrases that make some OTHER ticket the subject instead. */
const OTHER_SUBJECT_RE = /\bBL-\d+\b|\b(?:another|other|a different|that|the earlier|the older) (?:ticket|one|filing)\b/gi;

/**
 * Words that turn a claim into its own denial. "It is NOT retired", "kept
 * rather than retired" and "no longer superseded" are all statements that the
 * disposition did NOT happen, and holding on them is the same false positive
 * in a different costume.
 */
const CLAIM_NEGATION_RE = /\b(?:not|never|no longer|rather than|instead of|isn't|is not|was not|wasn't)\b/i;

export interface SelfClaim {
  /** The top-level YAML field the claim was found in, named in the reason. */
  field: string;
  /** The claim word itself, as written. */
  claim: string;
}

interface YamlField {
  name: string;
  text: string;
}

/**
 * Split a ticket YAML into its top-level fields. Continuation lines (block
 * scalars, list items, nested maps) belong to the field that opened them, so
 * a claim can be attributed to the field a reader can go and look at.
 */
export function splitTopLevelFields(yamlText: string): YamlField[] {
  const fields: YamlField[] = [];
  let current: YamlField = { name: 'preamble', text: '' };
  for (const line of yamlText.split('\n')) {
    const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (key) {
      if (current.text.length > 0) {
        fields.push(current);
      }
      current = { name: key[1], text: line.slice(key[1].length + 1) + '\n' };
      continue;
    }
    current.text += line + '\n';
  }
  if (current.text.length > 0) {
    fields.push(current);
  }
  return fields;
}

function lastIndexOfMatch(haystack: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(haystack)) !== null) {
    last = match.index;
    if (match.index === re.lastIndex) {
      re.lastIndex += 1;
    }
  }
  return last;
}

/**
 * Is this claim word predicated on the candidate itself? The nearest subject
 * before it in the same sentence decides: this ticket (or its own id) means
 * yes, another ticket means no, and no subject at all means the sentence
 * never said whose disposition it was describing — which is not evidence
 * about this one.
 */
function sentenceClaimsSelf(sentence: string, claimIndex: number, ownId: string): boolean {
  const before = sentence.slice(0, claimIndex);
  const ownIdRe = new RegExp(`\\b${ownId}\\b`, 'gi');
  const selfAt = Math.max(lastIndexOfMatch(before, SELF_SUBJECT_RE), lastIndexOfMatch(before, ownIdRe));
  if (selfAt < 0) {
    return false;
  }
  // The claim has to be this subject's PREDICATE, not merely downstream of it
  // in a long sentence: "this ticket is the fix, so the convention can
  // eventually be retired" retires the convention, not the ticket.
  if (before.length - selfAt > SELF_CLAIM_PREDICATE_WINDOW) {
    return false;
  }
  const otherAt = lastIndexOfMatch(before.replace(ownIdRe, (m) => ' '.repeat(m.length)), OTHER_SUBJECT_RE);
  if (otherAt > selfAt) {
    return false;
  }
  return !CLAIM_NEGATION_RE.test(before.slice(selfAt));
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;:])\s+/);
}

/**
 * The narrowed generic-claim predicate: a claim about THIS ticket, or null.
 * A structured disposition field carrying a claim word is one by definition -
 * the field describes the ticket it sits on. Everywhere else the claim has to
 * be bound to the ticket by the sentence carrying it.
 */
/**
 * A claim word inside a filename, a wiring anchor or a hyphenated compound is
 * naming a SURFACE, not stating a disposition: `BL-1263-stale-assertions-are-
 * retired-...feature` is a path, and "the retired-type guard" is a thing the
 * ticket builds. Only a free-standing word can be a claim about the ticket.
 */
function matchProseClaim(sentence: string): RegExpMatchArray | null {
  const re = new RegExp(STALE_CLAIM_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(sentence)) !== null) {
    const before = sentence.slice(0, match.index);
    const after = sentence.slice(match.index + match[0].length);
    const tokenStart = before.length - (before.match(/[^\s]*$/) as RegExpMatchArray)[0].length;
    const token = sentence.slice(tokenStart).split(/\s/)[0];
    // A sentence-ending full stop is not a path separator: only a slash, a
    // wiring anchor's `::`, or a dot leading into an extension makes the
    // token a path.
    const partOfPath = /\/|::|\.[A-Za-z0-9]/.test(token);
    // `superseded-by-BL-8` is a disposition naming its successor, not a
    // compound noun, so a trailing ticket id does not disqualify the claim.
    const hyphenCompound = /^-(?!BL-\d)[A-Za-z]/.test(after) || /[A-Za-z]-$/.test(before);
    if (!partOfPath && !hyphenCompound) {
      return match;
    }
  }
  return null;
}

export function findSelfClaim(yamlText: string, ticketId: string): SelfClaim | null {
  const ownId = normalizeTicketId(ticketId);
  for (const field of splitTopLevelFields(yamlText)) {
    const structured = SELF_DISPOSITION_FIELDS.includes(field.name);
    for (const sentence of splitSentences(field.text)) {
      const match = matchProseClaim(sentence);
      if (!match || match.index === undefined) {
        continue;
      }
      if (structured && !CLAIM_NEGATION_RE.test(sentence.slice(0, match.index))) {
        return { field: field.name, claim: match[0] };
      }
      if (!structured && sentenceClaimsSelf(sentence, match.index, ownId)) {
        return { field: field.name, claim: match[0] };
      }
    }
  }
  return null;
}

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

  // BL-1268: a claim about THIS ticket, not any prose mention of a
  // deprecation. The reason names the field so the adjudicating specifier can
  // look at one field instead of grepping the whole ticket.
  const selfClaim = findSelfClaim(facts.yamlText, facts.ticketId);
  if (selfClaim && !facts.doneClosureExists) {
    return hold(
      `ticket claims itself ${selfClaim.claim.toLowerCase()} in field '${selfClaim.field}' without a backlog/done/ closure`
    );
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
