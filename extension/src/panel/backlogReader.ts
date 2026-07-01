import * as fs from 'fs';
import * as path from 'path';

export interface BacklogItem {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  assignedTo?: string;
  milestone?: string;
  priority?: number;
  dependsOn?: string[];
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

export function parseBacklogYaml(content: string): BacklogItem | null {
  const id = parseYamlScalar(content, 'id');
  const title = parseYamlScalar(content, 'title');
  const statusRaw = parseYamlScalar(content, 'status');

  if (!id || !title || !statusRaw) {
    return null;
  }
  if (!VALID_STATUSES.has(statusRaw)) {
    return null;
  }

  const item: BacklogItem = { id, title, status: statusRaw as BacklogItem['status'] };

  const assignedTo = parseYamlScalar(content, 'assigned_to');
  if (assignedTo) {
    item.assignedTo = assignedTo;
  }

  const milestone = parseYamlScalar(content, 'milestone');
  if (milestone) {
    item.milestone = milestone;
  }

  const priorityStr = parseYamlScalar(content, 'priority');
  if (priorityStr !== undefined) {
    const n = Number(priorityStr);
    if (!Number.isNaN(n)) {
      item.priority = n;
    }
  }

  const dependsOn = parseYamlList(content, 'depends_on');
  if (dependsOn) {
    item.dependsOn = dependsOn;
  }

  return item;
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

export function readBacklog(targetPath: string): BacklogItem[] {
  // The folder is authoritative: the pipeline moves files between backlog
  // folders without touching the yaml status field, so a promoted item may
  // still say "status: todo".
  const activeItems = readYamlFiles(path.join(targetPath, 'backlog', 'active'), 'active');
  const doneItems = readYamlFiles(path.join(targetPath, 'backlog', 'done'), 'done');

  activeItems.sort((a, b) => (a.priority ?? MAX_PRIORITY) - (b.priority ?? MAX_PRIORITY));

  return [...activeItems, ...doneItems];
}
