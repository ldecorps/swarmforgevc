#!/usr/bin/env node
/**
 * BL-786: resolve Stryker mutation concurrency from the launching host (or pin)
 * and pass --concurrency to the wrapped command. Every mutation npm script
 * must go through scripts/mutation-concurrency.js run -- ...
 */
import * as os from 'os';
import { spawn } from 'child_process';
import {
  DECLARED_PEAK_RSS_PER_WORKER_BYTES,
  DEFAULT_RESERVE_BYTES,
} from '../metrics/mutationConcurrencyConstants';
import { recommendMutationConcurrency } from '../metrics/mutationWorkerRss';
import { readNumberFlag } from './profile-mutation-workers';
import { runCliMain } from './swarm-metrics';

export const MUTATION_CONCURRENCY_ENV = 'MUTATION_CONCURRENCY';

export type MutationConcurrencySource = 'computed' | 'pinned';

export interface MutationConcurrencyResolution {
  concurrency: number;
  source: MutationConcurrencySource;
  freeRamBytes: number;
  coreCount: number;
  peakRssPerWorkerBytes: number;
  reserveBytes: number;
  pin?: number;
}

export interface ResolveMutationConcurrencyInput {
  freeRamBytes: number;
  coreCount: number;
  peakRssPerWorkerBytes: number;
  reserveBytes: number;
  pin?: number;
}

export function resolveMutationConcurrency(
  input: ResolveMutationConcurrencyInput
): MutationConcurrencyResolution {
  const base = {
    freeRamBytes: input.freeRamBytes,
    coreCount: input.coreCount,
    peakRssPerWorkerBytes: input.peakRssPerWorkerBytes,
    reserveBytes: input.reserveBytes,
  };
  if (input.pin !== undefined && Number.isFinite(input.pin) && input.pin > 0) {
    return { ...base, concurrency: Math.floor(input.pin), source: 'pinned', pin: Math.floor(input.pin) };
  }
  return {
    ...base,
    concurrency: recommendMutationConcurrency({
      freeRamBytes: input.freeRamBytes,
      peakRssPerWorkerBytes: input.peakRssPerWorkerBytes,
      coreCount: input.coreCount,
      reserveBytes: input.reserveBytes,
    }),
    source: 'computed',
  };
}

export function readConcurrencyPinFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[MUTATION_CONCURRENCY_ENV];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function formatMutationConcurrencyReport(resolution: MutationConcurrencyResolution): string {
  const freeMb = Math.round(resolution.freeRamBytes / (1024 * 1024));
  const peakMb = Math.round(resolution.peakRssPerWorkerBytes / (1024 * 1024));
  const reserveMb = Math.round(resolution.reserveBytes / (1024 * 1024));
  const pinNote =
    resolution.source === 'pinned' && resolution.pin !== undefined
      ? ` (pinned via ${MUTATION_CONCURRENCY_ENV}=${resolution.pin})`
      : '';
  return [
    `mutation-concurrency: ${resolution.concurrency} (${resolution.source})${pinNote}`,
    `  free_ram_mb=${freeMb} cores=${resolution.coreCount} peak_rss_per_worker_mb=${peakMb} reserve_mb=${reserveMb}`,
  ].join('\n');
}

export function withStrykerConcurrencyFlag(commandArgs: string[], concurrency: number): string[] {
  const next = [...commandArgs];
  const flagIdx = next.indexOf('--concurrency');
  if (flagIdx !== -1 && flagIdx < next.length - 1) {
    next[flagIdx + 1] = String(concurrency);
    return next;
  }
  return [...next, '--concurrency', String(concurrency)];
}

export interface LaunchMutationCommandDeps {
  spawn: typeof spawn;
  log: (line: string) => void;
}

export function launchMutationCommand(
  resolution: MutationConcurrencyResolution,
  command: string,
  commandArgs: string[],
  deps: LaunchMutationCommandDeps
): ReturnType<typeof spawn> {
  deps.log(formatMutationConcurrencyReport(resolution));
  const args = withStrykerConcurrencyFlag(commandArgs, resolution.concurrency);
  return deps.spawn(command, args, { stdio: 'inherit', shell: false });
}

export function resolveFromHost(
  overrides: Partial<ResolveMutationConcurrencyInput> = {},
  env: NodeJS.ProcessEnv = process.env
): MutationConcurrencyResolution {
  return resolveMutationConcurrency({
    freeRamBytes: overrides.freeRamBytes ?? os.freemem(),
    coreCount: overrides.coreCount ?? os.cpus().length,
    peakRssPerWorkerBytes: overrides.peakRssPerWorkerBytes ?? DECLARED_PEAK_RSS_PER_WORKER_BYTES,
    reserveBytes: overrides.reserveBytes ?? DEFAULT_RESERVE_BYTES,
    pin: overrides.pin ?? readConcurrencyPinFromEnv(env),
  });
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sepIdx = argv.indexOf('--');
  const targetArgs = sepIdx === -1 ? [] : argv.slice(sepIdx + 1);
  if (targetArgs.length === 0) {
    process.stderr.write(
      'Usage: mutation-concurrency.js [--pin N] run -- <command> [args...]\n'
    );
    process.exitCode = 1;
    return;
  }
  const cliArgs = argv.slice(0, sepIdx);
  if (cliArgs[0] !== 'run') {
    process.stderr.write('mutation-concurrency.js: first argument must be "run"\n');
    process.exitCode = 1;
    return;
  }
  const pin = readNumberFlag(cliArgs, '--pin', Number.NaN);
  const pinValue = Number.isFinite(pin) && pin > 0 ? pin : readConcurrencyPinFromEnv();
  const resolution = resolveFromHost({ pin: pinValue });
  const [command, ...commandArgs] = targetArgs;
  const child = launchMutationCommand(resolution, command, commandArgs, {
    spawn,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

if (require.main === module) {
  runCliMain(main);
}
