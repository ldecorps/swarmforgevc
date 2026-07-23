// Reads a single `config <key> <value>` line from swarmforge/swarmforge.conf
// (swarm_name, recert_email_to, pwa_base_url, and any future key all share
// this exact shape) - one definition, so every caller's own regex/file-read
// wrapper never independently drifts from the others.
import * as fs from 'fs';
import * as path from 'path';

export function parseConfigValue(confContent: string, key: string): string | undefined {
  const match = confContent.match(new RegExp(`^\\s*config\\s+${key}\\s+(\\S+)`, 'm'));
  return match ? match[1] : undefined;
}

export function readConfigValue(targetPath: string, key: string): string | undefined {
  try {
    return parseConfigValue(fs.readFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'utf8'), key);
  } catch {
    return undefined;
  }
}
