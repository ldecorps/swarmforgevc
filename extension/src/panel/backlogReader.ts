import * as fs from 'fs';
import * as path from 'path';

export interface BacklogItem {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  assignedTo?: string;
}

function parseYamlScalar(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

export function parseBacklogYaml(content: string): BacklogItem | null {
  const id = parseYamlScalar(content, 'id');
  const title = parseYamlScalar(content, 'title');
  const statusRaw = parseYamlScalar(content, 'status');

  if (!id || !title || !statusRaw) {
    return null;
  }
  if (statusRaw !== 'todo' && statusRaw !== 'active' && statusRaw !== 'done') {
    return null;
  }

  const assignedTo = parseYamlScalar(content, 'assigned_to');
  const item: BacklogItem = { id, title, status: statusRaw };
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
