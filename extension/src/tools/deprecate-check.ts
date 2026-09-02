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
import * as crypto from 'crypto';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export type FreshnessDecision =
  // BL-1267: an allow may now carry a reason - the discharge names the
  // adjudication record it came from, so no clearance is anonymous.
  | { decision: 'allow'; reason?: string }
  | { decision: 'hold'; reason: string };

/**
 * BL-1267: Article 3.6's four adjudication outcomes. Only confirm_promote
 * discharges a hold; the other three change the TICKET, so the next gate run
 * sees different text and decides again from it.
 */
export type AdjudicationOutcome = 'confirm_promote' | 'amend' | 'retire' | 'split';

export interface AdjudicationRecord {
  ticket: string;
  outcome: AdjudicationOutcome;
  adjudicated_by: string;
  adjudicated_at: string;
  /** Fingerprint of the ticket content this adjudication was made against. */
  content_fingerprint: string;
}

/**
 * What the gate found where an adjudication would live. `unusable` is NOT
 * `absent`: a record that cannot be read or parsed is a signal that something
 * is wrong with the discharge, and the gate is fail-closed.
 */
export type AdjudicationFact =
  | { status: 'absent' }
  | { status: 'unusable'; path: string; problem: string }
  | { status: 'present'; path: string; record: AdjudicationRecord };

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
  /** BL-1267: the recorded Article 3.6 adjudication, if any. */
  adjudication?: AdjudicationFact;
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

/**
 * Is this one prose sentence's claim word a claim about the ticket? A
 * structured disposition field carrying a claim word is one by definition -
 * the field describes the ticket it sits on. A prose field's claim has to be
 * bound to the ticket by the sentence carrying it.
 */
function sentenceCarriesSelfClaim(sentence: string, matchIndex: number, structured: boolean, ownId: string): boolean {
  if (structured) {
    return !CLAIM_NEGATION_RE.test(sentence.slice(0, matchIndex));
  }
  return sentenceClaimsSelf(sentence, matchIndex, ownId);
}

/** Scan one YAML field's sentences for the first claim about the ticket. */
function findClaimInField(field: YamlField, structured: boolean, ownId: string): SelfClaim | null {
  for (const sentence of splitSentences(field.text)) {
    const match = matchProseClaim(sentence);
    if (!match || match.index === undefined) {
      continue;
    }
    if (sentenceCarriesSelfClaim(sentence, match.index, structured, ownId)) {
      return { field: field.name, claim: match[0] };
    }
  }
  return null;
}

/**
 * The narrowed generic-claim predicate: a claim about THIS ticket, or null.
 */
export function findSelfClaim(yamlText: string, ticketId: string): SelfClaim | null {
  const ownId = normalizeTicketId(ticketId);
  for (const field of splitTopLevelFields(yamlText)) {
    const structured = SELF_DISPOSITION_FIELDS.includes(field.name);
    const found = findClaimInField(field, structured, ownId);
    if (found) {
      return found;
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

/**
 * BL-1267: the ticket's YAML wherever it currently sits. Exported so the
 * adjudication writer fingerprints the SAME text the gate reads, rather than
 * carrying its own copy of the lookup that could drift from it.
 */
export function findTicketYamlPath(root: string, ticketId: string): string | undefined {
  return (
    findTicketYaml(root, ticketId, 'paused') ??
    findTicketYaml(root, ticketId, 'active') ??
    findTicketYaml(root, ticketId, 'done')
  );
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

// BL-1193: what a RETIRED marker actually RETIRES, on one docs line.
//
// The old extractor took the first word-like token anywhere earlier on the
// line (`/\b([a-z][a-z0-9_-]{2,})\b.*\bRETIRED\b/i`) plus any path-like
// token anywhere on it. That conflates "co-occurs on a line with a RETIRED
// marker" with "is the thing the marker retires". The live table row
//
//     | Mint hygiene (`backlog_hygiene_lib.bb`) | `type: bug` → `RETIRED-TICKET-TYPE …` |
//
// retires `type: bug`, and yielded "Mint" and "backlog_hygiene_lib.bb"
// instead - so any ticket using this project's own everyday vocabulary
// ("mint a ticket", "Mint-time gate") earned a fail-closed hold before every
// promotion. BL-1190, BL-1193 itself and BL-1206 were all held on exactly
// that word.
//
// A marker now yields a referent only when the line actually predicates the
// retirement of something, in one of three shapes, and the referent is taken
// ADJACENT to the marker rather than from the far end of the line:
//
//   (a) mapping     `type: bug` → `RETIRED-TICKET-TYPE …`
//   (b) predication  the legacy-verb path is now RETIRED
//   (c) announcement RETIRED: legacy-verb
//
// Prose that merely mentions the word - "the description still names
// **RETIRED** behaviour", "mint `RETIRED-TICKET-TYPE`" - names nothing and
// yields nothing, which is the honest answer for a line that retires nothing.

// Words that carry no referent: the connective tissue between a thing and
// the statement that it was retired.
const RETIRED_STOP_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'and', 'or', 'but',
  'is', 'was', 'are', 'were', 'been', 'now', 'still', 'also', 'has', 'have',
  'had', 'it', 'its', 'be', 'to', 'in', 'of', 'as', 'by', 'for', 'path',
  'file', 'helper', 'module', 'entry', 'point', 'line', 'code', 'behaviour',
  'behavior', 'marker', 'gate', 'rule', 'field', 'value', 'type',
]);

/**
 * Is this bare token specific enough to BE a referent? An identifier-shaped
 * token (a dot, dash or underscore in it) or a long word can name a surface;
 * a short ordinary English word on a prose line almost never does, and
 * accepting one is how "Mint" became a retired token in the first place.
 */
function looksLikeReferent(token: string): boolean {
  if (RETIRED_STOP_WORDS.has(token.toLowerCase())) {
    return false;
  }
  return /[_./-]/.test(token) || token.length >= 8;
}

/**
 * A backticked span, or the nearest identifier-shaped bare token, on the
 * referent side of the marker. Backticks win: the docs quote what they name.
 */
function referentBefore(text: string): string | undefined {
  const quoted = [...text.matchAll(/`([^`]+)`/g)];
  if (quoted.length > 0) {
    return quoted[quoted.length - 1][1].trim();
  }
  // Walk backwards through the trailing words, skipping connectives, and
  // take the first token that could actually name something.
  const words = text.match(/[A-Za-z0-9_./-]+/g) ?? [];
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (looksLikeReferent(words[i])) {
      return words[i];
    }
  }
  return undefined;
}

function referentAfter(text: string): string | undefined {
  const quoted = text.match(/^\s*`([^`]+)`/);
  if (quoted) {
    return quoted[1].trim();
  }
  const words = text.match(/[A-Za-z0-9_./-]+/g) ?? [];
  return words.find((word) => looksLikeReferent(word));
}

/**
 * The referent for ONE marker occurrence, or undefined if this marker
 * retires nothing (used in prose, or naming a marker being explained). The
 * three shapes are checked in order and are mutually exclusive by
 * construction - a line matching (a) never falls through to (b) or (c),
 * even when (a) matched but named no referent, matching the original
 * three-branch continue-on-match control flow exactly.
 */
function referentForMarker(before: string, after: string): string | undefined {
  // (a) mapping: `<referent>` → RETIRED..., allowing the marker to open a
  // quoted span of its own (`→ \`RETIRED-TICKET-TYPE …\``).
  const mapping = before.match(/(->|=>|→|⇒|=)\s*`?\s*$/);
  if (mapping) {
    return referentBefore(before.slice(0, before.length - mapping[0].length));
  }
  // (b) predication: <referent> is|was|are|were|now RETIRED
  const predication = before.match(/\b(?:is|was|are|were|been|now)\b[\s`*_]*$/i);
  if (predication) {
    return referentBefore(before.slice(0, before.length - predication[0].length));
  }
  // (c) announcement: RETIRED: <referent> / RETIRED — <referent>
  const announcement = after.match(/^[-:—–]\s*(?!TICKET)/);
  if (announcement) {
    return referentAfter(after.slice(announcement[0].length));
  }
  return undefined;
}

/**
 * The tokens a line's RETIRED marker(s) actually retire. Pure: one line in,
 * zero or more referents out - the BL-654 property target for this ticket's
 * declared invariant.
 */
export function extractRetiredReferents(line: string): string[] {
  const referents: string[] = [];
  const markerRe = /\bRETIRED\b/g;
  let marker: RegExpExecArray | null;
  while ((marker = markerRe.exec(line)) !== null) {
    const before = line.slice(0, marker.index);
    const after = line.slice(marker.index + marker[0].length);
    const referent = referentForMarker(before, after);
    if (referent) {
      referents.push(referent);
    }
  }
  return referents;
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
      for (const referent of extractRetiredReferents(line)) {
        tokens.add(referent);
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

// ── BL-1267: the discharge path ─────────────────────────────────────────
//
// Article 3.6 gives the specifier four outcomes on a hold. Three of them
// change the ticket, so the next gate run sees different text and decides
// again from it. The fourth - confirm promote - changed nothing this CLI
// could read, so an adjudicated ticket held forever and the only ways past it
// were a starved promotion queue or an unattributed bypass (BL-1190,
// BL-1256).
//
// The record lives OUTSIDE the ticket, under .swarmforge/deprecator/, for two
// reasons: gate state does not belong in a human-edited artifact, and an
// adjudication necessarily discusses the deprecation vocabulary that earned
// the hold - writing it into the ticket would arm the generic-claim branch
// against the very ticket it cleared.
//
// It is fingerprinted against the ticket content it was made against, so
// amending the ticket afterwards re-arms the gate rather than riding a stale
// clearance. There is deliberately NO environment variable, flag or caller
// argument that produces an allow: a control that silences the alarm along
// with the action is the defect, not the feature (BL-1248).

const ADJUDICATION_OUTCOMES: AdjudicationOutcome[] = ['confirm_promote', 'amend', 'retire', 'split'];

/** Where a ticket's adjudication record lives. */
export function adjudicationRecordPath(root: string, ticketId: string): string {
  return path.join(root, '.swarmforge', 'deprecator', 'adjudications', `${normalizeTicketId(ticketId)}.json`);
}

/**
 * The two mutations `promote_and_route_next.sh` makes to a ticket AFTER the
 * freshness gate has passed: it appends `\nassigned_to: <role>\n` when the
 * field is absent, and rewrites the line's value in place when it is present.
 * Leaving them in the fingerprint made every promotion invalidate the
 * adjudication that authorized it (BL-1338).
 */
const APPENDED_ROUTING_STAMP = /\n\nassigned_to:[^\n]*\n$/;
const ROUTING_STAMP_LINE = /^assigned_to:[^\n]*$/gm;

/**
 * The ticket text the fingerprint is taken over: the whole YAML with only the
 * promotion's own routing stamp neutralised - its appended form removed
 * exactly as the script writes it, and any remaining top-level `assigned_to:`
 * stripped of its value so re-routing is not an edit. Every other byte is
 * carried through untouched, INCLUDING whitespace: BL-1267's re-arm on a
 * substantive edit is what the fingerprint exists for and is not narrowed by
 * anything beyond the stamp.
 */
export function fingerprintableTicketText(yamlText: string): string {
  return yamlText.replace(APPENDED_ROUTING_STAMP, '\n').replace(ROUTING_STAMP_LINE, 'assigned_to:');
}

/**
 * The fingerprint an adjudication is bound to. Content, not mtime or commit:
 * a ticket that is rewritten byte-for-byte identically is the same ticket,
 * and one that changes by a single character of SPEC is not the one that was
 * cleared - see `fingerprintableTicketText` for the one exception, the
 * promotion's own routing stamp (BL-1338).
 */
export function computeTicketFingerprint(yamlText: string): string {
  return crypto.createHash('sha256').update(fingerprintableTicketText(yamlText), 'utf8').digest('hex');
}

/** Parse the raw JSON text; a syntax error or a non-object shape are both refusals. */
function parseJsonObject(raw: string): Partial<AdjudicationRecord> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'not valid JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'not a JSON object';
  }
  return parsed as Partial<AdjudicationRecord>;
}

/** Every field present, non-empty, and outcome one of the four Article 3.6 values. */
function firstShapeViolation(record: Partial<AdjudicationRecord>): string | null {
  for (const field of ['ticket', 'outcome', 'adjudicated_by', 'adjudicated_at', 'content_fingerprint'] as const) {
    if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
      return `missing or empty field '${field}'`;
    }
  }
  if (!ADJUDICATION_OUTCOMES.includes(record.outcome as AdjudicationOutcome)) {
    return `unknown outcome '${record.outcome}'`;
  }
  return null;
}

function parseAdjudicationRecord(raw: string, ticketId: string): AdjudicationRecord | string {
  const parsed = parseJsonObject(raw);
  if (typeof parsed === 'string') {
    return parsed;
  }
  const shapeError = firstShapeViolation(parsed);
  if (shapeError) {
    return shapeError;
  }
  const record = parsed as AdjudicationRecord;
  if (normalizeTicketId(record.ticket) !== normalizeTicketId(ticketId)) {
    return `record names ticket ${record.ticket}, not ${normalizeTicketId(ticketId)}`;
  }
  return record;
}

/** Read the adjudication record for a ticket. Unreadable is never absent. */
export function readAdjudication(root: string, ticketId: string): AdjudicationFact {
  const file = adjudicationRecordPath(root, ticketId);
  if (!fs.existsSync(file)) {
    return { status: 'absent' };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { status: 'unusable', path: file, problem: `unreadable (${(err as Error).message})` };
  }
  const parsed = parseAdjudicationRecord(raw, ticketId);
  if (typeof parsed === 'string') {
    return { status: 'unusable', path: file, problem: parsed };
  }
  return { status: 'present', path: file, record: parsed };
}

/**
 * Given a hold and whatever adjudication was found, the decision that stands.
 * Pure - it is handed the facts, never the filesystem or the environment.
 */
/**
 * Given a PRESENT adjudication record, the discharge it earns: confirm_promote
 * against matching content allows, anything else leaves the hold standing (a
 * non-matching outcome unchanged, a stale fingerprint re-armed by name).
 */
function dischargeFromRecord(
  held: FreshnessDecision,
  adjudication: Extract<AdjudicationFact, { status: 'present' }>,
  facts: TicketFreshnessFacts
): FreshnessDecision {
  const { record, path: recordPath } = adjudication;
  if (record.outcome !== 'confirm_promote') {
    return held;
  }
  const fingerprint = computeTicketFingerprint(facts.yamlText);
  if (record.content_fingerprint !== fingerprint) {
    return hold(
      `adjudication ${recordPath} no longer matches the ticket content it was made against ` +
        `(recorded ${record.content_fingerprint.slice(0, 12)}, ticket is now ${fingerprint.slice(0, 12)}) — re-adjudicate`
    );
  }
  return {
    decision: 'allow',
    reason: `discharged by adjudication ${recordPath}: confirm_promote by ${record.adjudicated_by} at ${record.adjudicated_at}`,
  };
}

export function applyAdjudication(held: FreshnessDecision, facts: TicketFreshnessFacts): FreshnessDecision {
  if (held.decision !== 'hold') {
    return held;
  }
  const adjudication = facts.adjudication ?? { status: 'absent' };
  if (adjudication.status === 'absent') {
    return held;
  }
  if (adjudication.status === 'unusable') {
    return hold(
      `unusable adjudication record ${adjudication.path}: ${adjudication.problem} — fail closed (original hold: ${held.reason})`
    );
  }
  return dischargeFromRecord(held, adjudication, facts);
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
    // BL-1267: read once here, with the rest of the facts, so the decision
    // function stays pure and testable against a literal.
    adjudication: readAdjudication(root, id),
  };
}

function hold(reason: string): FreshnessDecision {
  return { decision: 'hold', reason };
}

export function evaluateDeprecatorFreshness(facts: TicketFreshnessFacts): FreshnessDecision {
  // BL-1267: earn the verdict from the stale-premise signals first, then let
  // a fingerprinted adjudication discharge it. This ticket adds a way to
  // discharge a hold, never a way to avoid earning one.
  return applyAdjudication(evaluateStalePremiseSignals(facts), facts);
}

function evaluateStalePremiseSignals(facts: TicketFreshnessFacts): FreshnessDecision {
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
    // BL-1267: an allow may carry the adjudication that discharged the hold;
    // keep it so the promotion path can log WHY it was allowed to proceed.
    return typeof reason === 'string' && reason.length > 0 ? { decision: 'allow', reason } : { decision: 'allow' };
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
