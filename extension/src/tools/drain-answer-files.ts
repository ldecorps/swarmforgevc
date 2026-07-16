#!/usr/bin/env node
/**
 * BL-440: drains ANSWER-*.md files committed at the backlog root - the
 * human->swarm offline return path, resolving BL-242's deferred decision
 * (b). Symmetric with the specifier's own manual backlog-root INTAKE drain
 * (swarmforge/roles/specifier.prompt's "Drain the backlog root first") and
 * BL-311's operator-intake archive-not-delete convention. Mirrors
 * bridge-recert-proposals.ts's own "an offline/serverless surface can only
 * reach the swarm via a git commit, so a CLI ingests it" posture (BL-217) -
 * here the human's own offline commit+push IS the delivery mechanism.
 *
 * THE GATE (mandatory, no bypass): an answer is only acted on when the
 * ticket it references is still OPEN (not shipped to backlog/done/, not
 * itself marked status: done). A closed or unresolvable reference is NEVER
 * executed - it is reported instead ("arrived late, not executed" for a
 * real but no-longer-open reference; "unresolved" for a reference that
 * cannot even be parsed), and BOTH surfaces already exist: the referenced
 * ticket's own git-committed BL-topic record (blTopicStore.ts, BL-329),
 * which projects into the live Telegram topic when a front desk is
 * connected. An unresolvable answer has no ticket to attach a record to,
 * so it is deliberately left in place at the backlog root rather than
 * archived - BL-311's own "an un-drained file signals itself by still
 * being there" convention, applied to the one case this drain cannot act
 * on at all.
 *
 * Usage: node drain-answer-files.js <repo-root>
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { appendMessage } from '../concierge/blTopicStore';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface DrainAnswerFilesArgs {
  repoRoot: string;
}

export function parseArgs(argv: string[]): DrainAnswerFilesArgs | null {
  const [repoRoot] = argv;
  return repoRoot ? { repoRoot } : null;
}

const ANSWER_FILE_PATTERN = /^ANSWER-.*\.md$/;
// BL-440's own schema is deliberately forgiving (composed by a human on a
// plane, not a machine): no required header syntax, just a BL-### ticket
// id mentioned anywhere in the file. The whole file's own trimmed content
// is carried through as "the human's words" - never re-parsed further,
// never rejected for missing optional structure.
const TICKET_REFERENCE_PATTERN = /\bBL-(\d+)\b/i;

export interface ParsedAnswer {
  reference: string | null;
  body: string;
}

export function parseAnswerFile(content: string): ParsedAnswer {
  const match = content.match(TICKET_REFERENCE_PATTERN);
  return {
    reference: match ? `BL-${match[1]}` : null,
    body: content.trim(),
  };
}

export function backlogAnswerFiles(repoRoot: string): string[] {
  const backlogRoot = path.join(repoRoot, 'backlog');
  try {
    return fs.readdirSync(backlogRoot).filter((entry) => ANSWER_FILE_PATTERN.test(entry));
  } catch {
    return [];
  }
}

const TICKET_FOLDERS = ['active', 'paused', 'done'] as const;
export type TicketFolder = (typeof TICKET_FOLDERS)[number];

export interface FoundTicket {
  folder: TicketFolder;
  filePath: string;
  status: string | undefined;
}

export function findTicketFile(repoRoot: string, ticketId: string): FoundTicket | null {
  for (const folder of TICKET_FOLDERS) {
    const dir = path.join(repoRoot, 'backlog', folder);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const match = entries.find((entry) => entry.startsWith(`${ticketId}-`) && entry.endsWith('.yaml'));
    if (match) {
      const filePath = path.join(dir, match);
      const status = fs.readFileSync(filePath, 'utf8').match(/^status:\s*(\S+)/m)?.[1];
      return { folder, filePath, status };
    }
  }
  return null;
}

export type PremiseCheck = { live: true } | { live: false; reason: string };

// BL-440's own gate: NEVER blind-execute a late answer. A ticket only
// counts as "still open" when it is found outside backlog/done/ AND its
// own status field is not already "done" - the single real signal this
// slice checks (no fabricated "retracted"/"superseded" state exists
// anywhere in this codebase to check against instead; both narratively
// collapse to "this ticket is no longer awaiting the input" just as much
// as "shipped" does).
export function checkPremiseLive(repoRoot: string, ticketId: string): PremiseCheck {
  const found = findTicketFile(repoRoot, ticketId);
  if (!found) {
    return { live: false, reason: `${ticketId} is no longer found anywhere in backlog/active, backlog/paused, or backlog/done` };
  }
  if (found.folder === 'done') {
    return { live: false, reason: `${ticketId} has already shipped (backlog/done/)` };
  }
  if (found.status === 'done') {
    return { live: false, reason: `${ticketId}'s own status is already "done"` };
  }
  return { live: true };
}

export type AnswerDisposition = 'acted-on' | 'arrived-late' | 'unresolved';

export interface DrainedAnswer {
  file: string;
  reference: string | null;
  disposition: AnswerDisposition;
  report?: string;
}

function answerArchiveDir(repoRoot: string): string {
  return path.join(repoRoot, 'backlog', 'answers-archive');
}

// Moves the drained file out of the backlog root in the SAME commit as its
// removal - never a bare `fs.rename` left uncommitted, and never a second,
// separate commit that could land only one half. Mirrors
// gitCommitScopedFile.ts's own scoped-add-then-commit shape, widened to the
// two paths a move touches; fails open (returns false, logged, never
// throws) exactly like every other committer in this codebase - the
// in-repo move itself has already happened either way, so a later run
// (or a human `git add`) can still land the durable half.
function archiveAnswerFile(repoRoot: string, sourcePath: string, fileName: string): boolean {
  const archiveDir = answerArchiveDir(repoRoot);
  fs.mkdirSync(archiveDir, { recursive: true });
  const destPath = path.join(archiveDir, fileName);
  fs.renameSync(sourcePath, destPath);
  try {
    execFileSync('git', ['-C', repoRoot, 'add', '--', sourcePath, destPath], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', `Archive drained ${fileName}\n\nBy coder.`, '--', sourcePath, destPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// The one place BOTH dispositions that resolved to a real ticket route
// through - BL-329's own committed BL-topic record, which projects into
// the live Telegram topic when a front desk is connected and IS the
// "committed note" surface otherwise. Never a second, parallel record.
function routeToTopicRecord(repoRoot: string, ticketId: string, message: { author: string; type: 'inbound' | 'outbound'; text: string }): void {
  appendMessage(repoRoot, ticketId, message);
}

export function drainAnswerFiles(repoRoot: string): DrainedAnswer[] {
  const results: DrainedAnswer[] = [];
  for (const file of backlogAnswerFiles(repoRoot)) {
    const filePath = path.join(repoRoot, 'backlog', file);
    const { reference, body } = parseAnswerFile(fs.readFileSync(filePath, 'utf8'));

    if (!reference) {
      results.push({
        file,
        reference: null,
        disposition: 'unresolved',
        report: `${file}: no BL-### reference could be resolved from its content - left in place at the backlog root (BL-311's own "still there means undrained" signal), never silently dropped`,
      });
      continue;
    }

    const premise = checkPremiseLive(repoRoot, reference);
    if (premise.live) {
      routeToTopicRecord(repoRoot, reference, { author: 'human', type: 'inbound', text: body });
      archiveAnswerFile(repoRoot, filePath, file);
      results.push({ file, reference, disposition: 'acted-on' });
    } else {
      const report = `arrived late, not executed - ${premise.reason}`;
      routeToTopicRecord(repoRoot, reference, { author: 'swarm', type: 'outbound', text: report });
      archiveAnswerFile(repoRoot, filePath, file);
      results.push({ file, reference, disposition: 'arrived-late', report });
    }
  }
  return results;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node drain-answer-files.js <repo-root>\n',
  async (args) => {
    printJsonToStdout(drainAnswerFiles(args.repoRoot));
  }
);

if (require.main === module) {
  runCliMain(main);
}
