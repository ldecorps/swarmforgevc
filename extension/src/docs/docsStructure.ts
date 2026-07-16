// BL-456: the docs-structure validator - a small, host-side module that
// checks the project's docs/ tree actually follows the Divio Documentation
// System's four modes (tutorials/how-to/reference/explanation), same
// pure-derivation/impure-read split as docsTree.ts (buildDocsTree/
// computeDocsTree) and docs-tree-schema.md's own generator pattern. The
// PROSE quality of a rewritten doc (does a tutorial teach, is a how-to a
// task recipe, ...) is a human/QA judgment, not asserted here - this module
// only checks the STRUCTURAL contract: the four mode directories exist,
// each has at least one document, docs/index.md classifies each mode with
// its reader orientation, and every authored doc under a mode directory is
// linked from the index (no orphans).
import * as fs from 'fs';
import * as path from 'path';

export const DIVIO_MODES = ['tutorials', 'how-to', 'reference', 'explanation'] as const;
export type DivioMode = (typeof DIVIO_MODES)[number];

// The reader-orientation word each mode's own index section must carry -
// the Divio system's own vocabulary (learning-oriented / task-oriented /
// information-oriented / understanding-oriented), not invented here.
export const DIVIO_MODE_ORIENTATIONS: Record<DivioMode, string> = {
  tutorials: 'learning',
  'how-to': 'task',
  reference: 'information',
  explanation: 'understanding',
};

export interface DivioModeState {
  exists: boolean;
  // Markdown file paths relative to the mode directory (posix separators),
  // including files nested under a subdirectory (e.g. "specs/BL-007-spec.md").
  files: string[];
}

export interface DocsStructureInput {
  modes: Record<DivioMode, DivioModeState>;
  indexContent: string | null; // null when docs/index.md is missing
}

export interface OrphanedDoc {
  mode: DivioMode;
  file: string;
}

export interface DocsStructureReport {
  missingModeDirs: DivioMode[];
  emptyModeDirs: DivioMode[];
  modesWithoutOrientation: DivioMode[];
  orphanedDocs: OrphanedDoc[];
  indexMissing: boolean;
}

const ORIENTATION_SCAN_WINDOW = 400;

// The character offset of the markdown HEADING line naming `mode` (e.g. "##
// How-to guides"), or -1 if none exists. Anchoring on a heading line -
// rather than any substring occurrence of the mode name anywhere in the
// document - matters: "reference" is an ordinary English word a doc's own
// intro prose can easily mention ahead of its actual "## Reference"
// section (docs/index.md's own intro does exactly this, linking the
// diagrams "from Reference below"), and a bare substring search would
// anchor on that incidental mention instead of the real section.
function findModeHeadingIndex(indexContent: string, mode: DivioMode): number {
  const headingPattern = new RegExp(`^#{1,6}\\s.*\\b${mode}\\b`, 'i');
  const lines = indexContent.split('\n');
  let offset = 0;
  for (const line of lines) {
    if (headingPattern.test(line)) {
      return offset;
    }
    offset += line.length + 1;
  }
  return -1;
}

// A mode is "classified with its orientation" when its own heading line is
// found and its orientation word appears shortly after it - the shape every
// section in docs/index.md actually takes ("## How-to guides" followed
// shortly by "*Task-oriented: ...*").
function modeIsClassifiedWithOrientation(indexContent: string, mode: DivioMode): boolean {
  const headingIndex = findModeHeadingIndex(indexContent, mode);
  if (headingIndex === -1) {
    return false;
  }
  const window = indexContent.slice(headingIndex, headingIndex + ORIENTATION_SCAN_WINDOW).toLowerCase();
  return window.includes(DIVIO_MODE_ORIENTATIONS[mode]);
}

// A doc is "reachable from the index" when its mode-relative path appears
// as a link target somewhere in the index content. docs/index.md links a
// space-containing filename (e.g. "Milestone Roadmap.MD") URL-encoded
// (%20) per normal Markdown practice - normalizing that back to a literal
// space before comparing means either form is recognized as linked.
function isDocLinkedInIndex(indexContent: string, mode: DivioMode, file: string): boolean {
  const normalized = indexContent.replace(/%20/g, ' ');
  return normalized.includes(`${mode}/${file}`);
}

// Pure - the unit/acceptance seam. Everything impure (walking the mode
// directories, reading index.md) lives in computeDocsStructure below.
export function computeDocsStructureReport(input: DocsStructureInput): DocsStructureReport {
  const missingModeDirs = DIVIO_MODES.filter((mode) => !input.modes[mode].exists);
  const emptyModeDirs = DIVIO_MODES.filter((mode) => input.modes[mode].exists && input.modes[mode].files.length === 0);
  const indexMissing = input.indexContent === null;
  const modesWithoutOrientation = indexMissing
    ? [...DIVIO_MODES]
    : DIVIO_MODES.filter((mode) => !modeIsClassifiedWithOrientation(input.indexContent as string, mode));

  const orphanedDocs: OrphanedDoc[] = [];
  if (!indexMissing) {
    for (const mode of DIVIO_MODES) {
      for (const file of input.modes[mode].files) {
        if (!isDocLinkedInIndex(input.indexContent as string, mode, file)) {
          orphanedDocs.push({ mode, file });
        }
      }
    }
  }

  return { missingModeDirs, emptyModeDirs, modesWithoutOrientation, orphanedDocs, indexMissing };
}

// Recursively lists markdown files under `dir`, returned as posix-separator
// paths relative to `dir` - reference/specs/*.md must be seen as
// "specs/BL-007-spec.md", not skipped for being nested one level deeper.
function listMarkdownFilesRecursive(dir: string, prefix = ''): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listMarkdownFilesRecursive(path.join(dir, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(relativePath);
    }
  }
  return files;
}

function readModeState(docsDir: string, mode: DivioMode): DivioModeState {
  const modeDir = path.join(docsDir, mode);
  let exists: boolean;
  try {
    exists = fs.statSync(modeDir).isDirectory();
  } catch {
    exists = false;
  }
  return { exists, files: exists ? listMarkdownFilesRecursive(modeDir) : [] };
}

// The one impure entry point: reads the mode directories and docs/index.md
// off disk under `targetPath` (the repo top-level, resolved by the caller -
// never a cwd-relative path, per the engineering repo-scoped-path rule),
// then delegates to the pure report above.
export function computeDocsStructure(targetPath: string): DocsStructureReport {
  const docsDir = path.join(targetPath, 'docs');
  const modes = {} as Record<DivioMode, DivioModeState>;
  for (const mode of DIVIO_MODES) {
    modes[mode] = readModeState(docsDir, mode);
  }
  let indexContent: string | null;
  try {
    indexContent = fs.readFileSync(path.join(docsDir, 'index.md'), 'utf8');
  } catch {
    indexContent = null;
  }
  return computeDocsStructureReport({ modes, indexContent });
}
