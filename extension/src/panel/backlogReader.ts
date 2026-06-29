import * as fs from 'fs';
import * as path from 'path';

export interface BacklogItem {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  assignedTo?: string;
}

const VALID_STATUSES = new Set(['todo', 'active', 'done']);
const YAML_FIELDS = { id: 'id', title: 'title', status: 'status', assignedTo: 'assigned_to' } as const;

function parseYamlScalar(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

export function parseBacklogYaml(content: string): BacklogItem | null {
  const id = parseYamlScalar(content, YAML_FIELDS.id);
  const title = parseYamlScalar(content, YAML_FIELDS.title);
  const statusRaw = parseYamlScalar(content, YAML_FIELDS.status);

  if (!id || !title || !statusRaw) {
    return null;
  }
  if (!VALID_STATUSES.has(statusRaw)) {
    return null;
  }

  const assignedTo = parseYamlScalar(content, YAML_FIELDS.assignedTo);
  const item: BacklogItem = { id, title, status: statusRaw as BacklogItem['status'] };
  if (assignedTo) {
    item.assignedTo = assignedTo;
  }
  return item;
}

function readYamlFiles(dir: string): BacklogItem[] {
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
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}

export function readBacklog(targetPath: string): BacklogItem[] {
  const activeItems = readYamlFiles(path.join(targetPath, 'backlog', 'active'));
  const doneItems = readYamlFiles(path.join(targetPath, 'backlog', 'done'));
  return [...activeItems, ...doneItems];
}
