import * as fs from 'fs';
import * as path from 'path';

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
  fs.mkdirSync(dir, { recursive: true });
  const yaml =
    `role: ${data.role}\n` +
    `pid: ${data.pid}\n` +
    `last_beat: "${data.last_beat}"\n` +
    `last_tool: ${data.last_tool}\n` +
    `phase: ${data.phase}\n` +
    `in_flight: ${data.in_flight}\n` +
    `beat_count: ${data.beat_count}\n`;
  const filePath = path.join(dir, `${data.role}.yaml`);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, yaml, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readHeartbeat(dir: string, role: string): HeartbeatData | undefined {
  const filePath = path.join(dir, `${role}.yaml`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const obj: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      let val: string | boolean | number = m[2].trim().replace(/^"(.*)"$/, '$1');
      if (val === 'true') val = true as boolean;
      else if (val === 'false') val = false as boolean;
      else if (/^\d+$/.test(val as string)) val = parseInt(val as string, 10);
      obj[key] = val;
    }
    return obj as unknown as HeartbeatData;
  } catch {
    return undefined;
  }
}
