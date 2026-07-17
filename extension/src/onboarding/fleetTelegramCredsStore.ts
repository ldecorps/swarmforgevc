import * as fs from 'fs';
import * as path from 'path';

// BL-436: a swarm's Telegram identity is a property of the SWARM (keyed by
// its own swarm_name), not of whatever shell launched it - the write
// counterpart of swarmforge/scripts/fleet_telegram_creds_lib.bb, which
// front_desk_supervisor.bb reads at launch. Lives under the HOST home
// directory (~/.swarmforge/fleet/<swarm_name>/telegram.json) - never
// inside the target working tree (secrets rule; this is the bot token,
// the same category telegramChannelSecretStore.ts already keeps outside
// the target for the single-swarm case).
export interface FleetTelegramCreds {
  botToken: string;
  chatId: string;
  bridgePort: number;
}

export function fleetTelegramCredsPath(homeDir: string, swarmName: string): string {
  return path.join(homeDir, '.swarmforge', 'fleet', swarmName, 'telegram.json');
}

export function writeFleetTelegramCreds(homeDir: string, swarmName: string, creds: FleetTelegramCreds): void {
  const filePath = fleetTelegramCredsPath(homeDir, swarmName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function readFleetTelegramCreds(homeDir: string, swarmName: string): FleetTelegramCreds | undefined {
  try {
    return JSON.parse(fs.readFileSync(fleetTelegramCredsPath(homeDir, swarmName), 'utf8')) as FleetTelegramCreds;
  } catch {
    return undefined;
  }
}
