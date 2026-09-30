// BL-1732: builds and commits the INTAKE file Submit writes at the backlog
// root, and the human-facing confirmation naming its permalink. The
// permalink math mirrors swarmforge/scripts/operator_lib.bb's own
// github-base-from-remote-url/github-permalink/filed-intake-confirmation-
// text (BL-415's operator_file_question.bb is the closest prior art) -
// ported rather than shelled out to, since this is pure string formatting,
// not a git write.
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runCommitIntegrityDetailed } from '../util/commitIntegrityRunner';
import { promoteVocabulary, vocabularyRelativePath, NarrativeSlot } from './intakeVocabularyStore';

const execFileAsync = promisify(execFile);

export interface IntakeDraft {
  actor: string;
  action: string;
  goal: string;
  scenarios: string; // free text, one or more Given/When/Then (+And/But) blocks
  rule?: string; // optional "any rule that should always hold?" text
  notes?: string;
  newValues?: Partial<Record<NarrativeSlot, string>>; // values this draft added, promoted on submit
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function todayStamp(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// BL-1732 QA bounce D1: two submits sharing a day AND a goal (the goal is
// a 5-value seeded dropdown - not a rare collision) used to name the SAME
// path and the second silently overwrote the first, both reported as
// filed. `existsAt` (checked against the REAL target root by submitIntake
// below) walks the -2, -3, ... suffix until it finds a path nothing
// already occupies; omitted, this stays the pure base-path function
// existing callers/tests already rely on.
export function intakeFileRelPath(draft: IntakeDraft, now: Date, existsAt?: (relPath: string) => boolean): string {
  const slug = slugify(draft.goal) || 'intake';
  const base = `INTAKE-${slug}-${todayStamp(now)}`;
  const pathFor = (suffix: string) => path.join('backlog', `${base}${suffix}.md`);
  if (!existsAt) {
    return pathFor('');
  }
  let n = 1;
  let candidate = pathFor('');
  while (existsAt(candidate)) {
    n += 1;
    candidate = pathFor(`-${n}`);
  }
  return candidate;
}

// Pure: the markdown body Submit writes. A blank rule field leaves NO rule
// section at all (scenario 08) - the field travels with the intake only
// when it holds real text (scenario 07).
export function renderIntakeMarkdown(draft: IntakeDraft): string {
  const rule = (draft.rule ?? '').trim();
  const notes = (draft.notes ?? '').trim();
  const parts = [
    `As ${draft.actor}, I want to ${draft.action}, so I can ${draft.goal}.`,
    '',
    draft.scenarios.trim(),
  ];
  if (rule) {
    parts.push('', '## Rule', '', rule);
  }
  if (notes) {
    parts.push('', '## Notes', '', notes);
  }
  return `${parts.join('\n')}\n`;
}

export function githubBaseFromRemoteUrl(remoteUrl: string | undefined | null): string | undefined {
  if (!remoteUrl || !remoteUrl.trim()) {
    return undefined;
  }
  const trimmed = remoteUrl.trim();
  const stripDotGit = (s: string) => s.replace(/\.git$/, '');
  if (trimmed.startsWith('git@github.com:')) {
    return `https://github.com/${stripDotGit(trimmed.slice('git@github.com:'.length))}`;
  }
  if (trimmed.startsWith('https://github.com/')) {
    return `https://github.com/${stripDotGit(trimmed.slice('https://github.com/'.length))}`;
  }
  return undefined;
}

export function githubPermalink(githubBase: string | undefined, sha: string, relPath: string): string | undefined {
  return githubBase ? `${githubBase}/blob/${sha}/${relPath.split(path.sep).join('/')}` : undefined;
}

export function filedIntakeConfirmationText(relPath: string, sha: string, remoteUrl: string | undefined | null): string {
  const permalink = githubPermalink(githubBaseFromRemoteUrl(remoteUrl), sha, relPath);
  return permalink ? `Filed for the swarm: ${relPath} — ${permalink}` : `Filed for the swarm: ${relPath}`;
}

async function originRemoteUrl(targetPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', targetPath, 'remote', 'get-url', 'origin']);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export type SubmitIntakeResult =
  | { ok: true; relPath: string; sha: string; confirmationText: string }
  | { ok: false; reason: string };

const NARRATIVE_SLOTS: NarrativeSlot[] = ['actor', 'action', 'goal'];

// BL-1732 QA bounce D2 (invariant 1): a value added via "add new" then
// abandoned (the dropdown switched back to an existing value) must never
// join the shared vocabulary - only promote a newValues[slot] entry that
// is ACTUALLY the draft's own chosen value for that slot. A stale
// newValues[slot] the client failed to clear is caught here too, as a
// second line of defense.
function usedNewValues(draft: IntakeDraft): Partial<Record<NarrativeSlot, string>> {
  const used: Partial<Record<NarrativeSlot, string>> = {};
  for (const slot of NARRATIVE_SLOTS) {
    const candidate = draft.newValues?.[slot];
    if (candidate !== undefined && candidate === draft[slot]) {
      used[slot] = candidate;
    }
  }
  return used;
}

// Writes the INTAKE file and the promoted vocabulary, commits both TOGETHER
// through commit_integrity_cli.bb (the front desk's own commit path,
// BL-1368), and returns the human-facing confirmation with the file's
// permalink. Never partially commits: a commit failure (BL-1732 QA bounce
// D3) restores the vocabulary file to exactly what it held before this
// call and removes the INTAKE file this call wrote - commit-with-integrity
// itself restores only the git INDEX, never a working-tree file it did not
// touch, so this function must undo its own two writes on the failure path
// (never "filed" - a refused Submit files nothing and shares nothing).
export async function submitIntake(targetPath: string, draft: IntakeDraft, now: Date = new Date()): Promise<SubmitIntakeResult> {
  const relPath = intakeFileRelPath(draft, now, (p) => fs.existsSync(path.join(targetPath, p)));
  const absPath = path.join(targetPath, relPath);
  const vocabPath = path.join(targetPath, vocabularyRelativePath());
  const priorVocabText = fs.existsSync(vocabPath) ? fs.readFileSync(vocabPath, 'utf8') : undefined;

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, renderIntakeMarkdown(draft));
  promoteVocabulary(targetPath, usedNewValues(draft));

  const result = await runCommitIntegrityDetailed(
    targetPath,
    [relPath, vocabularyRelativePath()],
    `Intake: ${draft.actor} wants to ${draft.action}\n\nBy the human, filed via the Intake topic form.`
  );
  if (!result.success || !result.sha) {
    fs.rmSync(absPath, { force: true });
    if (priorVocabText === undefined) {
      fs.rmSync(vocabPath, { force: true });
    } else {
      fs.writeFileSync(vocabPath, priorVocabText);
    }
    return { ok: false, reason: result.reason ?? 'commit failed' };
  }
  const remoteUrl = await originRemoteUrl(targetPath);
  return {
    ok: true,
    relPath,
    sha: result.sha,
    confirmationText: filedIntakeConfirmationText(relPath, result.sha, remoteUrl),
  };
}
