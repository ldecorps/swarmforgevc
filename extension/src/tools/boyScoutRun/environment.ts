/**
 * BL-1015 — the default `RunEnvironment`: reading a proposal a caller has
 * already written, and the real-disk IO it runs against. Split out of
 * `boyScoutRun.ts` (BL-485 mutation-site size: the file was still 224 sites
 * after the first split, over the 100-site threshold).
 */

import * as fs from 'fs';
import * as path from 'path';

import { scan } from '../boyScoutScan';

import { commitEdits } from './commit';
import { runDeclaredGates } from './gates';
import { PROPOSAL_PATH } from './types';
import type { CleanupProposal, FileEdit, RunEnvironment } from './types';

/**
 * The default proposer reads a proposal a caller has already written. The run
 * deliberately does not GENERATE cleanups: it is the half that bounds and
 * verifies them, and a generator that invented its own edits would have no
 * bound on it at all. Whatever wrote the file — a person, an agent — still has
 * to get past the envelope, the assertion guard and the gate set in
 * `boyScoutRun.ts`.
 *
 * A missing or malformed file is "no proposal", never a crash and never a
 * silent success.
 */
function isWellFormedProposal(candidate: Partial<CleanupProposal>): boolean {
  return !!candidate && typeof candidate.subject === 'string' && Array.isArray(candidate.edits);
}

function isWellFormedEdit(edit: unknown): edit is FileEdit {
  const e = edit as Partial<FileEdit> | null;
  return !!e && typeof e.path === 'string' && (typeof e.after === 'string' || e.after === null);
}

export function readProposalFile(root: string, readFile: RunEnvironment['readFile']): CleanupProposal | null {
  const raw = readFile(root, PROPOSAL_PATH);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const candidate = parsed as Partial<CleanupProposal>;
  if (!isWellFormedProposal(candidate)) return null;
  const edits = candidate.edits!.filter(isWellFormedEdit);
  return { subject: candidate.subject!, summary: candidate.summary ?? candidate.subject!, edits };
}

export const defaultEnvironment: RunEnvironment = {
  scanRepository: (root) => scan(root),
  propose: (_item, root, readFile) => readProposalFile(root, readFile),
  readFile: (root, relPath) => {
    const abs = path.join(root, relPath);
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  },
  writeFile: (root, relPath, content) => {
    const abs = path.join(root, relPath);
    if (content === null) {
      fs.rmSync(abs, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  },
  runGates: (root) => runDeclaredGates(root),
  commit: (root, message, paths) => commitEdits(root, message, paths),
};
