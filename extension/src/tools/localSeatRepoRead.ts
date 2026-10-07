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

/** docs/reference/local-model-briefing.md runs to about 465 words (~3000
 * bytes) by design (BL-1682: a local window truncates). This cap keeps the
 * repo-read half of the prompt from drowning that out or the model's own
 * context window - picked as roughly the same order of magnitude as the
 * briefing itself, leaving headroom for the question text and the model's
 * reply budget. */
export const REPO_READ_MAX_BYTES = 4000;

const SECRET_BASENAMES = new Set(['bridge-token']);

/** True for any repo-relative path matching a known secret-file convention:
 * the cursor bridge token, and any `.env`-suffixed file (covers `.env`
 * itself and `swarm.env`). Checked on the BASENAME only, so a secret stays
 * caught regardless of which directory it sits under. */
export function isSecretRelPath(relPath: string): boolean {
  const base = path.basename(relPath);
  return SECRET_BASENAMES.has(base) || base.endsWith('.env');
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

const TICKET_ID_PATTERN = /\bBL-\d+\b/g;
const BACKLOG_SUBDIRS = ['active', 'paused', 'done', 'hold', 'archive'];

/** The ticket's own YAML file under backlog/<subdir>/, found by id prefix -
 * the same `<id>-*.yaml` naming every backlog file already uses. */
function findTicketFile(targetPath: string, ticketId: string): string | undefined {
  for (const subdir of BACKLOG_SUBDIRS) {
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

  const pathTokens = new Set(
    Array.from(question.match(PATH_TOKEN_PATTERN) ?? [], stripSurroundingPunctuation).filter(Boolean)
  );
  for (const token of pathTokens) {
    const resolved = resolveWithinRepo(targetPath, token);
    if (!resolved) {
      continue;
    }
    const relPath = path.relative(targetPath, resolved);
    if (isSecretRelPath(relPath)) {
      // Never read, never logged with its content - the filter runs before
      // anything from this path can reach `snippets`.
      continue;
    }
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        continue;
      }
      snippets.push(fs.readFileSync(resolved, 'utf8'));
    } catch {
      // Not found, not readable, or not a plain file - nothing to add.
    }
  }

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
