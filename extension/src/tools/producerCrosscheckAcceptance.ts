/**
 * BL-733: pure helpers for the pilot acceptance gate's producer output-space
 * crosscheck on pattern/regex tickets. Side effects (reading swarmforge.conf,
 * setting env for acceptance runs) stay in pilot-acceptance-gate.ts and step
 * handlers; this module is decision logic only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { displayNameForRole } from '../panel/needsHumanDetection';

export const PRODUCER_CROSSCHECK_ENV = 'SWARMFORGE_PRODUCER_CROSSCHECK';

export const DISPLAY_NAME_FOR_ROLE_PRODUCER = 'swarmforge.sh::display_name_for_role';

export const PRODUCER_CROSSCHECK_REQUIRED_REFUSAL =
  'missing producer output-space crosscheck is insufficient for pattern/regex tickets';

export interface ProducerCrosscheckMetadata {
  producer: string;
  outputSpaceSize: number;
  valuesChecked: number;
  exhaustive: boolean;
}

const PATTERN_ACCEPTANCE_RE =
  /\b(?:pattern|regex|chrome|display[-_]name|pane[-_]title|producer[-_]crosscheck|role[-_]crosscheck)\b/i;

const PATTERN_WIRING_RE = /\b(?:pattern|regex|producer)\b/i;

export function isPatternTicket(
  acceptance: string | undefined,
  requiredWiring: string[] | undefined
): boolean {
  if (acceptance && PATTERN_ACCEPTANCE_RE.test(acceptance)) {
    return true;
  }
  if (!requiredWiring) {
    return false;
  }
  return requiredWiring.some((entry) => PATTERN_WIRING_RE.test(entry));
}

export function rolesFromSwarmforgeConf(confText: string): string[] {
  const roles: string[] = [];
  for (const line of confText.split('\n')) {
    const match = line.trim().match(/^window\s+(\S+)/);
    if (match) {
      roles.push(match[1]);
    }
  }
  return roles;
}

export function enumerateDisplayNameForRoleOutputs(roles: string[]): string[] {
  return roles.map((role) => displayNameForRole(role));
}

export function readConfiguredRoleNames(repoRoot: string): string[] {
  const confPath = path.join(repoRoot, 'swarmforge', 'swarmforge.conf');
  try {
    return rolesFromSwarmforgeConf(fs.readFileSync(confPath, 'utf8'));
  } catch {
    return [];
  }
}

export function parseProducerCrosscheckFromEnv(raw?: string): ProducerCrosscheckMetadata | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as ProducerCrosscheckMetadata;
    if (
      typeof parsed.producer !== 'string' ||
      typeof parsed.outputSpaceSize !== 'number' ||
      typeof parsed.valuesChecked !== 'number' ||
      typeof parsed.exhaustive !== 'boolean'
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function assessProducerCrosscheck(
  metadata: ProducerCrosscheckMetadata | undefined
): { satisfied: boolean; metadata?: ProducerCrosscheckMetadata } {
  if (!metadata) {
    return { satisfied: false };
  }
  const satisfied =
    metadata.exhaustive &&
    metadata.outputSpaceSize > 0 &&
    metadata.valuesChecked >= metadata.outputSpaceSize;
  return { satisfied, metadata };
}

export function recordProducerCrosscheck(metadata: ProducerCrosscheckMetadata): void {
  process.env[PRODUCER_CROSSCHECK_ENV] = JSON.stringify(metadata);
}

export function clearProducerCrosscheckEnv(): void {
  delete process.env[PRODUCER_CROSSCHECK_ENV];
}
