import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export interface HeartbeatData {
  role: string;
  pid: number;
  last_beat: string;
  last_tool: string;
  phase: 'entry' | 'exit';
  in_flight: boolean;
  beat_count: number;
  task?: string;
}

/**
 * Write a heartbeat YAML file for the given role in the specified directory.
 *
 * The file name is `${role}.yaml` and the content is a simple key/value YAML
 * mapping compatible with parseYamlLine() below.
 */
export function writeHeartbeat(dir: string, data: HeartbeatData): void {
  let yaml = `role: ${data.role}
pid: ${data.pid}
last_beat: "${data.last_beat}"
last_tool: ${data.last_tool}
phase: ${data.phase}
in_flight: ${data.in_flight}
beat_count: ${data.beat_count}
`;
  if (data.task) {
    yaml += `task: ${data.task}\n`;
  }
  const filePath = path.join(dir, `${data.role}.yaml`);
  atomicWrite(filePath, yaml);
}

/**
 * Parse a single "key: value" YAML line into a [key, value] pair.
 *
 * Supported types:
 * - strings (optionally quoted with double quotes)
 * - booleans ("true"/"false")
 * - integers (sequence of digits)
 *
 * Lines that do not match the expected "key: value" format are ignored.
 */
function parseYamlLine(line: string): [string, unknown] | null {
  const m = line.match(/^(\w+):\s*(.+)$/);
  if (!m) return null;
  const key = m[1];
  let val: string | boolean | number = m[2].trim().replace(/^"(.*)"$/, '$1');
  if (val === 'true') val = true;
  else if (val === 'false') val = false;
  else if (/^\d+$/.test(val)) val = parseInt(val, 10);
  return [key, val];
}

/**
 * Read the heartbeat YAML file for the given role from the specified directory.
 *
 * Returns a HeartbeatData object when the file exists and can be parsed, or
 * undefined if the file does not exist or cannot be read.
 *
 * This function is intentionally lenient: unknown keys are ignored and missing
 * files simply result in undefined instead of throwing.
 */
export function readHeartbeat(dir: string, role: string): HeartbeatData | undefined {
  const filePath = path.join(dir, `${role}.yaml`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const obj: Record<string, unknown> = {};

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      const parsed = parseYamlLine(line);
      if (parsed) obj[parsed[0]] = parsed[1];
    }

    return obj as unknown as HeartbeatData;
  } catch {
    return undefined;
  }
}
