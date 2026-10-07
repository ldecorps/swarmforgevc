/**
 * BL-1911: the local seat's read path.
 *
 * Ruling B (human pick, 2026-10-03): each turn the seat searches the target
 * repository for the question and sends what it found, in ONE model call -
 * never a tool-calling loop. This module is that search, kept PURE fs in,
 * text out, so `localQwenSeatLive.ts` can inject it the same way it injects
 * the endpoint probe and the completion call.
 *
 * Read-only and bounded to the repository: every candidate path is resolved
 * against `targetPath` and rejected if it resolves outside it (invariant 1's
 * "only inside its target repository"), and nothing here ever writes.
 *
 * The secret filter runs IN CODE, before anything is read into the context
 * string that reaches the model - never a prompt asking the model to behave.
 * A path whose basename matches a known secret-file convention (an `.env`
 * file, or the cursor bridge's `bridge-token`) is skipped outright: its
 * CONTENTS never enter the context, even when the question names it by path.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findTicketYamlPath } from './deprecate-check';

/** docs/reference/local-model-briefing.md runs to about 465 words (~3000
 * bytes) by design (BL-1682: a local window truncates). This cap keeps the
 * repo-read half of the prompt from drowning that out or the model's own
 * context window - picked as roughly the same order of magnitude as the
 * briefing itself, leaving headroom for the question text and the model's
 * reply budget. */
export const REPO_READ_MAX_BYTES = 4000;

const SECRET_BASENAMES = new Set(['bridge-token']);

// `.swarmforge/operator/` holds the operator's own secrets and credentials
// (the bridge token, vscode-cli tokens, swarm.env backups) - refused
// wholesale (QA bounce 2026-10-07, D1) rather than file by file, since a
// file new to that directory is a secret by convention, not by name.
const SECRET_DIR_PREFIX = '.swarmforge/operator/';

/** True when `lowerBasename` has "env" as a whole dot-delimited component
 * (`.env`, `swarm.env`, `swarm.env.bak-*`, `qwen.env.disabled`, `.env.local`)
 * rather than merely containing the substring - "environment.txt" must stay
 * ordinary. */
function hasEnvComponent(lowerBasename: string): boolean {
  return lowerBasename.split('.').includes('env');
}

/** True for any repo-relative path matching a known secret-file or
 * secret-directory convention: the cursor bridge token, anything under
 * `.swarmforge/operator/`, and any basename with an `env` component (covers
 * `.env` itself, `swarm.env`, and a backed-up, disabled, or dotfile variant
 * of either). Matched case-insensitively (QA bounce D2): macOS's default
 * APFS volume is case-insensitive, so `statSync`/`readFileSync` would still
 * open the real secret under a differently-cased name even though a
 * case-sensitive filter read it as not secret. */
export function isSecretRelPath(relPath: string): boolean {
  const lower = relPath.split(path.sep).join('/').toLowerCase();
  if (lower === SECRET_DIR_PREFIX.slice(0, -1) || lower.startsWith(SECRET_DIR_PREFIX)) {
    return true;
  }
  const base = path.basename(lower);
  return SECRET_BASENAMES.has(base) || hasEnvComponent(base);
}

/** `path.resolve`d target inside `root`, or undefined when the candidate
 * would resolve outside it (a `../` escape, or an absolute path elsewhere) -
 * invariant 1's "only inside its target repository", enforced structurally
 * rather than by trusting the caller's input. */
function resolveWithinRepo(root: string, candidate: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return undefined;
  }
  return resolved;
}

// QA bounce D4: GH-<n> ids (a GitHub-sourced ticket) are a real backlog id
// shape too, never matched by a BL-only pattern.
const TICKET_ID_PATTERN = /\b(?:BL|GH)-\d+\b/g;

// paused/active/done (including nested done/<milestone>/ directories, where
// 49% of done tickets live) are deprecate-check.ts's own domain answer
// (findTicketYamlPath, BL-1811: call the module that owns it, never
// re-derive it). hold/ and archive/ are outside that module's domain - it
// never reads them - so they stay this module's own flat, top-level check.
const FALLBACK_BACKLOG_SUBDIRS = ['hold', 'archive'];

/** The ticket's own YAML file under backlog/, found by id prefix - the same
 * `<id>-*.yaml` naming every backlog file already uses. */
function findTicketFile(targetPath: string, ticketId: string): string | undefined {
  // findTicketYamlPath's own match is a plain startsWith(id) with no
  // trailing separator (QA bounce D4's own note): asking about "BL-19"
  // would wrongly match a real "BL-1911-....yaml" if no "BL-19-*.yaml" file
  // existed. Guarded here by re-checking the precise `${id}-` prefix this
  // module has always matched on.
  const shared = findTicketYamlPath(targetPath, ticketId);
  if (shared && path.basename(shared).startsWith(`${ticketId}-`)) {
    return shared;
  }
  for (const subdir of FALLBACK_BACKLOG_SUBDIRS) {
    const dir = path.join(targetPath, 'backlog', subdir);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const match = names.find((name) => name.startsWith(`${ticketId}-`) && name.endsWith('.yaml'));
    if (match) {
      return path.join(dir, match);
    }
  }
  return undefined;
}

// A path-shaped token in free text: a run of non-space, non-quote characters
// that contains at least one '/' or '.' - covers both "backlog/active/x.yaml"
// and a bare ".env" or "bridge-token"-style name with no slash.
const PATH_TOKEN_PATTERN = /[^\s"']*[./][^\s"']*/g;

function stripSurroundingPunctuation(token: string): string {
  return token.replace(/^[('"]+/, '').replace(/[)'".,!?]+$/, '');
}

export interface RepoReadResult {
  /** False only when the repository itself could not be read at all. */
  ok: boolean;
  /** Text read this turn, truncated to the byte cap; '' when ok is true but
   * nothing in the question matched anything readable. */
  context: string;
  /** Set only when ok is false. */
  reason?: string;
}

/** The text of every ticket named by id in `question`, one entry per ticket
 * whose backlog YAML could be found and read. Split out of
 * `searchRepoForQuestion` (BL-1676/BL-1911 hardening) so each read strategy
 * carries its own, separately-measured CRAP score. */
function readTicketSnippets(targetPath: string, question: string): string[] {
  const snippets: string[] = [];
  const ticketIds = new Set(question.match(TICKET_ID_PATTERN) ?? []);
  for (const ticketId of ticketIds) {
    const file = findTicketFile(targetPath, ticketId);
    if (!file) {
      continue;
    }
    try {
      snippets.push(fs.readFileSync(file, 'utf8'));
    } catch {
      // One ticket file being unreadable does not fail the whole turn.
    }
  }
  return snippets;
}

/** The text at `token` (resolved against `targetPath`) when it exists, is a
 * plain file inside the repository, and is not a secret; `undefined`
 * otherwise. Never stats or reads a path the containment check or the secret
 * filter rejects - the filter runs before anything from that path could
 * reach a caller.
 *
 * QA bounce 2026-10-07 D3: the lexical check alone is not enough - a
 * symlink INSIDE the repository can point OUTSIDE it, or at a secret under
 * an innocuous name, and `statSync`/`readFileSync` follow symlinks
 * regardless of what the lexical path says. Both the containment check and
 * the secret filter below run against the REAL path (`fs.realpathSync`),
 * resolved before either check, so a symlink cannot read as something it
 * is not. */
function readSnippetForPathToken(targetPath: string, token: string): string | undefined {
  const resolved = resolveWithinRepo(targetPath, token);
  if (!resolved) {
    return undefined;
  }
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = fs.realpathSync(targetPath);
    realCandidate = fs.realpathSync(resolved);
  } catch {
    // Root unreadable, or candidate not found / not readable - nothing to add.
    return undefined;
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) {
    return undefined;
  }
  const relPath = path.relative(realRoot, realCandidate);
  if (isSecretRelPath(relPath)) {
    return undefined;
  }
  try {
    const stat = fs.statSync(realCandidate);
    if (!stat.isFile()) {
      return undefined;
    }
    return fs.readFileSync(realCandidate, 'utf8');
  } catch {
    // Not found, not readable, or not a plain file - nothing to add.
    return undefined;
  }
}

/** The text of every path-shaped token in `question` that resolves to an
 * existing plain file inside `targetPath` and is not a secret. */
function readPathTokenSnippets(targetPath: string, question: string): string[] {
  const pathTokens = new Set(
    Array.from(question.match(PATH_TOKEN_PATTERN) ?? [], stripSurroundingPunctuation).filter(Boolean)
  );
  const snippets: string[] = [];
  for (const token of pathTokens) {
    const snippet = readSnippetForPathToken(targetPath, token);
    if (snippet !== undefined) {
      snippets.push(snippet);
    }
  }
  return snippets;
}

/**
 * Reads whatever the question seems to name from inside `targetPath`: a
 * ticket id resolves to that ticket's backlog YAML, and a path-shaped token
 * resolves to that file's text when it exists, is inside the repository, and
 * is not a secret. Everything found is joined and capped at `maxBytes`.
 *
 * `ok: false` means the repository root itself could not be read (invariant
 * 2's failure case) - not merely that nothing matched the question, which is
 * a normal `ok: true, context: ''` outcome.
 */
export function searchRepoForQuestion(
  targetPath: string,
  question: string,
  maxBytes: number = REPO_READ_MAX_BYTES
): RepoReadResult {
  try {
    fs.readdirSync(targetPath);
  } catch (err) {
    return { ok: false, context: '', reason: (err as Error).message };
  }

  const snippets = [...readTicketSnippets(targetPath, question), ...readPathTokenSnippets(targetPath, question)];

  let context = snippets.join('\n\n').trim();
  if (context.length > maxBytes) {
    context = context.slice(0, maxBytes);
  }
  return { ok: true, context };
}

/** The text that reaches the model for this turn: what was read, prefixed
 * plainly, or - when the read failed outright - a plain statement of that
 * fact (invariant 2), followed by the operator's own question either way. */
export function buildPromptWithRepoContext(question: string, reading: RepoReadResult): string {
  if (!reading.ok) {
    return `(the repository could not be read: ${reading.reason})\n\n${question}`;
  }
  if (!reading.context) {
    return question;
  }
  return `Repository context for this turn:\n${reading.context}\n\n${question}`;
}
