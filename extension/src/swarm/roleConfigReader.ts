import * as fs from 'fs';
import * as path from 'path';
import { RoleConfig } from '../orchestrator/AgentRunner';

export const BOOTSTRAP_ROLE_CONFIGS: RoleConfig[] = [
  { role: 'specifier', displayName: 'Specifier', command: 'claude', args: ['--role=specifier'] },
  { role: 'coder', displayName: 'Coder', command: 'claude', args: ['--role=coder'] },
  { role: 'cleaner', displayName: 'Cleaner', command: 'claude', args: ['--role=cleaner'] },
];

export function readRoleConfigs(targetPath: string): RoleConfig[] {
  const tsvPath = path.join(targetPath, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(tsvPath)) {
    return BOOTSTRAP_ROLE_CONFIGS;
  }

  const configs: RoleConfig[] = [];
  for (const line of fs.readFileSync(tsvPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [role, displayName, command, ...rest] = line.split('\t');
    if (!role || !displayName || !command) {
      continue;
    }
    configs.push({ role, displayName, command, args: rest });
  }
  return configs;
}
