import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface BacklogItem {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  assignedTo?: string;
  milestone?: string;
  priority?: number;
  dependsOn?: string[];
  pack?: string[];
  // BL-090/BL-094: which swarm this ticket is assigned to. Absent means the
  // primary swarm (BL-090's own default) - callers must apply that fallback
  // themselves, since no swarm: field exists in live ticket YAML yet.
  swarm?: string;
  // BL-117: prose description and acceptance reference/inline-Gherkin, for
  // the docs drill-down explorer's ticket and Gherkin levels.
  description?: string;
  acceptance?: string;
}

const VALID_STATUSES = new Set(['todo', 'active', 'done']);

function parseYamlScalar(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

function parseYamlList(content: string, field: string): string[] | undefined {
  const blockMatch = content.match(new RegExp(`^${field}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, 'm'));
  if (!blockMatch) {
    return undefined;
  }
  const entries = blockMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
  return entries.length > 0 ? entries : undefined;
}

// BL-117: extracts a `field: |` (or `>`) literal block scalar's prose,
// dedented to its own minimum indentation - the lenient-parser counterpart
// to js-yaml's own block-scalar handling, for description/acceptance text
// on tickets whose free-form prose elsewhere in the file isn't strict YAML.
function parseYamlBlockScalar(content: string, field: string): string | undefined {
  const blockMatch = content.match(new RegExp(`^${field}:\\s*[|>][+-]?\\s*\\n((?:[ \\t]*\\n|[ \\t]+.*\\n?)*)`, 'm'));
  if (!blockMatch) {
    return undefined;
  }
  const rawLines = blockMatch[1].split('\n');
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
    rawLines.pop();
  }
  if (rawLines.length === 0) {
    return undefined;
  }
  const indent = Math.min(...rawLines.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)![0].length));
  return rawLines.map((l) => l.slice(indent)).join('\n');
}

// BL-117: acceptance is usually a single-line file reference
// (`specs/features/<name>.feature`) but older tickets carry inline Gherkin
// as a block scalar - try the scalar form first, then the block form.
function parseAcceptanceField(content: string): string | undefined {
  return parseYamlScalar(content, 'acceptance') ?? parseYamlBlockScalar(content, 'acceptance');
}

function parsePriority(priorityStr: string | undefined): number | undefined {
  if (priorityStr === undefined) return undefined;
  const n = Number(priorityStr);
  return !Number.isNaN(n) ? n : undefined;
}

// Assigns key only when value is truthy (undefined AND empty-string/empty-
// array both count as "field absent") - the shape every optional field
// EXCEPT priority uses, where 0 is a meaningful value, not an absence
// (assignIfDefined below). Split out of assignOptionalFields/
// assignOptionalFieldsFromObject so each stays under the CRAP<=6 gate as
// fields are added (BL-094's swarm: field pushed both over it) - a nested
// function body doesn't count toward its caller's complexity.
function assignIfTruthy<K extends keyof BacklogItem>(item: BacklogItem, key: K, value: BacklogItem[K] | undefined): void {
  if (value) {
    item[key] = value;
  }
}

function assignIfDefined<K extends keyof BacklogItem>(item: BacklogItem, key: K, value: BacklogItem[K] | undefined): void {
  if (value !== undefined) {
    item[key] = value;
  }
}

function assignOptionalFields(item: BacklogItem, content: string): void {
  assignIfTruthy(item, 'assignedTo', parseYamlScalar(content, 'assigned_to'));
  assignIfTruthy(item, 'milestone', parseYamlScalar(content, 'milestone'));
  assignIfDefined(item, 'priority', parsePriority(parseYamlScalar(content, 'priority')));
  assignIfTruthy(item, 'dependsOn', parseYamlList(content, 'depends_on'));
  assignIfTruthy(item, 'pack', parseYamlList(content, 'pack'));
  assignIfTruthy(item, 'swarm', parseYamlScalar(content, 'swarm'));
  assignIfTruthy(item, 'description', parseYamlBlockScalar(content, 'description'));
  assignIfTruthy(item, 'acceptance', parseAcceptanceField(content));
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return !Number.isNaN(n) ? n : undefined;
  }
  return undefined;
}

function toOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(String).filter((s) => s.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

// BL-117: js-yaml's default `|` clip chomping keeps exactly one trailing
// newline, while the lenient block-scalar extractor strips all trailing
// blank lines - trimmed here so description/acceptance read the same
// regardless of which parser path produced them.
function toTrimmedOptionalString(value: unknown): string | undefined {
  const str = toOptionalString(value);
  return str ? str.trim() : undefined;
}

// Builds a BacklogItem from a strictly-parsed js-yaml document. Reads only
// the known BacklogItem fields off the parsed object so extra keys elsewhere
// in the document (e.g. `evidence:`, `notes:`) never leak into the contract
// pinned by backlogReader.test.js.
// Split out of buildItemFromParsedObject (hardening pass, BL-129): isolates
// the required-field validation from optional-field assignment so each half
// stays independently low-complexity/testable.
function extractRequiredFields(obj: Record<string, unknown>): Pick<BacklogItem, 'id' | 'title' | 'status'> | null {
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const title = typeof obj.title === 'string' ? obj.title : undefined;
  const statusRaw = typeof obj.status === 'string' ? obj.status : undefined;

  if (!id || !title || !statusRaw || !VALID_STATUSES.has(statusRaw)) {
    return null;
  }
  return { id, title, status: statusRaw as BacklogItem['status'] };
}

function assignOptionalFieldsFromObject(item: BacklogItem, obj: Record<string, unknown>): void {
  assignIfTruthy(item, 'assignedTo', toOptionalString(obj.assigned_to));
  assignIfTruthy(item, 'milestone', toOptionalString(obj.milestone));
  assignIfDefined(item, 'priority', toOptionalNumber(obj.priority));
  assignIfTruthy(item, 'dependsOn', toOptionalStringList(obj.depends_on));
  assignIfTruthy(item, 'pack', toOptionalStringList(obj.pack));
  assignIfTruthy(item, 'swarm', toOptionalString(obj.swarm));
  assignIfTruthy(item, 'description', toTrimmedOptionalString(obj.description));
  assignIfTruthy(item, 'acceptance', toTrimmedOptionalString(obj.acceptance));
}

function buildItemFromParsedObject(obj: Record<string, unknown>): BacklogItem | null {
  const required = extractRequiredFields(obj);
  if (!required) {
    return null;
  }
  const item: BacklogItem = { ...required };
  assignOptionalFieldsFromObject(item, obj);
  return item;
}

function parseBacklogYamlLenient(content: string): BacklogItem | null {
  const id = parseYamlScalar(content, 'id');
  const title = parseYamlScalar(content, 'title');
  const statusRaw = parseYamlScalar(content, 'status');

  if (!id || !title || !statusRaw || !VALID_STATUSES.has(statusRaw)) {
    return null;
  }

  const item: BacklogItem = { id, title, status: statusRaw as BacklogItem['status'] };
  assignOptionalFields(item, content);
  return item;
}

// BL-129: try a real YAML parser first; a well-formed ticket gets a real
// parse instead of regex extraction. Some real tickets have free-form titles
// or notes that are not valid strict YAML (unquoted "key: value"-shaped
// text, multiline implicit keys) — js-yaml throws or returns a non-object
// for those, and this falls back to the lenient extractor rather than
// dropping the ticket.
export function parseBacklogYaml(content: string): BacklogItem | null {
  try {
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return buildItemFromParsedObject(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through to the lenient extractor below
  }
  return parseBacklogYamlLenient(content);
}

function readYamlFiles(dir: string, overrideStatus?: BacklogItem['status']): BacklogItem[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    try {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const item = parseBacklogYaml(content);
      if (item && overrideStatus !== undefined) {
        item.status = overrideStatus;
      }
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}

const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;

// Done tickets are grouped into per-milestone subfolders
// (backlog/done/<milestone>/*.yaml); flat files are still accepted during the
// transition. One level of subfolders is the contract — deeper nesting is
// ignored. The subfolder name is canonical for the item's milestone.
function readDoneItems(doneDir: string): BacklogItem[] {
  const flatItems = readYamlFiles(doneDir, 'done');
  let subdirs: string[];
  try {
    subdirs = fs
      .readdirSync(doneDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return flatItems;
  }
  const groupedItems = subdirs.flatMap((milestone) =>
    readYamlFiles(path.join(doneDir, milestone), 'done').map((item) => ({
      ...item,
      milestone,
    }))
  );
  return [...flatItems, ...groupedItems];
}

export function readBacklog(targetPath: string): BacklogItem[] {
  // The folder is authoritative: the pipeline moves files between backlog
  // folders without touching the yaml status field, so a promoted item may
  // still say "status: todo".
  const activeItems = readYamlFiles(path.join(targetPath, 'backlog', 'active'), 'active');
  const doneItems = readDoneItems(path.join(targetPath, 'backlog', 'done'));

  activeItems.sort((a, b) => (a.priority ?? MAX_PRIORITY) - (b.priority ?? MAX_PRIORITY));

  return [...activeItems, ...doneItems];
}

export interface BacklogFolders {
  active: BacklogItem[];
  paused: BacklogItem[];
  done: BacklogItem[];
}

// Unlike readBacklog (which normalizes for the panel's own display), this
// projects the three backlog folders as-is for consumers, such as the read
// bridge, that need to know which folder a ticket currently sits in.
export function readBacklogFolders(targetPath: string): BacklogFolders {
  return {
    active: readYamlFiles(path.join(targetPath, 'backlog', 'active')),
    paused: readYamlFiles(path.join(targetPath, 'backlog', 'paused')),
    done: readDoneItems(path.join(targetPath, 'backlog', 'done')),
  };
}
