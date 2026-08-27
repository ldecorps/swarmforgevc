import * as fs from 'fs';
import * as path from 'path';

const EXPORT_LINE =
  /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(\S+))\s*(?:#.*)?$/;

/** Parse `export KEY="value"` lines from `.swarmforge/swarm.env`. */
export function parseSwarmEnvExportLine(line: string): { key: string; value: string } | undefined {
  const match = line.match(EXPORT_LINE);
  if (!match) {
    return undefined;
  }
  const [, key, v1, v2, v3] = match;
  return { key, value: v1 ?? v2 ?? v3 ?? '' };
}

export function loadSwarmEnvFile(repoRoot: string): Record<string, string> {
  const filePath = path.join(repoRoot, '.swarmforge', 'swarm.env');
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const parsed = parseSwarmEnvExportLine(line);
    if (parsed) {
      out[parsed.key] = parsed.value;
    }
  }
  return out;
}

export function readSwarmEnvValue(repoRoot: string, key: string): string | undefined {
  const value = loadSwarmEnvFile(repoRoot)[key]?.trim();
  return value ? value : undefined;
}
