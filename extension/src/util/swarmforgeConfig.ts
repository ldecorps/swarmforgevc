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

// BL-584: pure parse of `.swarmforge/swarm-identity` text for the pack conf
// path (active_backlog_max_depth_conf_path). Tab-separated key\tvalue rows.
export function parseSwarmIdentityConfPath(identityContent: string): string | undefined {
  for (const line of identityContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const tab = trimmed.indexOf('\t');
    if (tab < 0) {
      continue;
    }
    if (trimmed.slice(0, tab) !== 'active_backlog_max_depth_conf_path') {
      continue;
    }
    const value = trimmed.slice(tab + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

// BL-584: pack-overridden timing keys from the identity conf path first;
// daemon-level keys (notify_email_*) fall back to the tracked conf.
export function readEffectiveConfigValue(targetPath: string, key: string): string | undefined {
  try {
    const identityPath = path.join(targetPath, '.swarmforge', 'swarm-identity');
    const identity = fs.readFileSync(identityPath, 'utf8');
    const persisted = parseSwarmIdentityConfPath(identity);
    if (persisted) {
      const confPath = path.isAbsolute(persisted) ? persisted : path.join(targetPath, persisted);
      const fromPack = parseConfigValue(fs.readFileSync(confPath, 'utf8'), key);
      if (fromPack !== undefined) {
        return fromPack;
      }
    }
  } catch {
    // missing/corrupt identity or pack conf → tracked fallback
  }
  return readConfigValue(targetPath, key);
}
