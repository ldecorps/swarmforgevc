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
}

export function writeHeartbeat(dir: string, data: HeartbeatData): void {
  const yaml = `role: ${data.role}
pid: ${data.pid}
last_beat: "${data.last_beat}"
last_tool: ${data.last_tool}
phase: ${data.phase}
in_flight: ${data.in_flight}
beat_count: ${data.beat_count}
`;
  const filePath = path.join(dir, `${data.role}.yaml`);
  atomicWrite(filePath, yaml);
}

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

export function readHeartbeat(dir: string, role: string): HeartbeatData | undefined {
  const filePath = path.join(dir, `${role}.yaml`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const obj: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
      const parsed = parseYamlLine(line);
      if (parsed) obj[parsed[0]] = parsed[1];
    }
    return obj as unknown as HeartbeatData;
  } catch {
    return undefined;
  }
}
