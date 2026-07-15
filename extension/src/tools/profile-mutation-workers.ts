#!/usr/bin/env node
/**
 * BL-427: measure-first profiling harness for Stryker mutation-run worker
 * memory. Wraps an already-configured mutation command (passed after `--`)
 * and samples its child worker processes' RSS at a fixed interval until it
 * exits, then reports each worker's peak RSS and a concurrency
 * recommendation from CURRENT free RAM (recommendMutationConcurrency).
 * extension/stryker.config.json's fixed "concurrency": 4 is unchanged by
 * this ticket - a separate follow-up wires the recommendation in
 * (multi-slice-wiring rule). Actually running a real mutation pass through
 * this harness and committing the resulting docs/ measurement report is a
 * QA/human-run step (RAM-heavy, scheduled overnight per article 3.4), not
 * something exercised by this file's own tests - they wrap a trivial,
 * instantly-exiting real process instead.
 *
 * Usage: node profile-mutation-workers.js [--interval-ms N] [--reserve-mb N] -- <command> [args...]
 */
import * as os from 'os';
import { execFileSync, spawn } from 'child_process';
import { sampleProcessStats } from '../metrics/resourceTelemetry';
import { RssSample, computePeakRssPerWorker, recommendMutationConcurrency } from '../metrics/mutationWorkerRss';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export const DEFAULT_RESERVE_MB = 2048;
const DEFAULT_INTERVAL_MS = 5000;

export interface SpawnedProcess {
  pid: number;
  onExit: (cb: (code: number | null) => void) => void;
}

export interface SampleAdapters {
  listChildPids: (parentPid: number) => number[];
  getStats: (pid: number) => { rssBytes: number; cpuPercent: number } | null;
}

export interface ProfilingAdapters extends SampleAdapters {
  spawnTarget: (command: string, args: string[]) => SpawnedProcess;
  scheduleTick: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTick: (handle: NodeJS.Timeout) => void;
  now: () => number;
}

export interface ProfilingSessionResult {
  samples: RssSample[];
  exitCode: number | null;
}

// Pure given its adapters: one sampling pass over a parent's CURRENT
// children. A child whose stats could not be read (already exited between
// the pid listing and the stats read - an inherent race in any
// point-in-time process sample) is skipped, never fabricated as a
// zero-RSS sample.
export function sampleWorkerChildrenOnce(parentPid: number, atMs: number, adapters: SampleAdapters): RssSample[] {
  const samples: RssSample[] = [];
  for (const pid of adapters.listChildPids(parentPid)) {
    const stats = adapters.getStats(pid);
    if (stats) {
      samples.push({ workerId: String(pid), rssBytes: stats.rssBytes, atMs });
    }
  }
  return samples;
}

// Orchestrates spawn -> periodic sample -> resolve-on-exit. Every real
// timer/process is adapter-injected so tests drive it with a fake
// scheduler and fake spawn (engineering no-real-timers rule) - only
// main()'s real wiring below uses setInterval/child_process.spawn for real.
export function runProfilingSession(
  command: string,
  args: string[],
  intervalMs: number,
  adapters: ProfilingAdapters
): Promise<ProfilingSessionResult> {
  return new Promise((resolve) => {
    const child = adapters.spawnTarget(command, args);
    const samples: RssSample[] = [];
    const timer = adapters.scheduleTick(() => {
      samples.push(...sampleWorkerChildrenOnce(child.pid, adapters.now(), adapters));
    }, intervalMs);
    child.onExit((exitCode) => {
      adapters.clearTick(timer);
      resolve({ samples, exitCode });
    });
  });
}

export interface ProfilingReport {
  perWorkerPeakRssBytes: Record<string, number>;
  maxPeakRssBytes: number | null;
  recommendedConcurrency: number | null;
}

// Pure: samples -> per-worker peaks -> a concurrency recommendation sized
// from the WORST-CASE (max) peak across workers, never an average -
// sizing from the average would under-provision headroom for whichever
// worker actually peaks highest.
export function buildProfilingReport(
  samples: RssSample[],
  ramContext: { freeRamBytes: number; coreCount: number; reserveBytes: number }
): ProfilingReport {
  const perWorkerPeakRssBytes = computePeakRssPerWorker(samples);
  const peakValues = Object.values(perWorkerPeakRssBytes);
  if (peakValues.length === 0) {
    return { perWorkerPeakRssBytes, maxPeakRssBytes: null, recommendedConcurrency: null };
  }
  const maxPeakRssBytes = Math.max(...peakValues);
  const recommendedConcurrency = recommendMutationConcurrency({
    freeRamBytes: ramContext.freeRamBytes,
    peakRssPerWorkerBytes: maxPeakRssBytes,
    coreCount: ramContext.coreCount,
    reserveBytes: ramContext.reserveBytes,
  });
  return { perWorkerPeakRssBytes, maxPeakRssBytes, recommendedConcurrency };
}

// ── real adapters (thin OS/process boundary) ────────────────────────────────

export function listChildPidsReal(parentPid: number): number[] {
  try {
    const output = execFileSync('ps', ['--ppid', String(parentPid), '-o', 'pid='], { encoding: 'utf8' }).trim();
    if (!output) {
      return [];
    }
    return output
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function spawnTargetReal(command: string, args: string[]): SpawnedProcess {
  const child = spawn(command, args, { stdio: 'inherit' });
  return {
    pid: child.pid ?? -1,
    onExit: (cb) => {
      child.on('exit', (code) => cb(code));
    },
  };
}

const REAL_ADAPTERS: ProfilingAdapters = {
  spawnTarget: spawnTargetReal,
  listChildPids: listChildPidsReal,
  getStats: sampleProcessStats,
  scheduleTick: setInterval,
  clearTick: clearInterval,
  now: Date.now,
};

// Pure argv-flag parsing, exported so its own branches (present/absent/
// trailing/non-numeric) are covered directly rather than only reachable
// through main()'s real-timer wiring.
export function readNumberFlag(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) {
    return fallback;
  }
  const value = Number(args[idx + 1]);
  return Number.isFinite(value) ? value : fallback;
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sepIdx = argv.indexOf('--');
  const targetArgs = sepIdx === -1 ? [] : argv.slice(sepIdx + 1);
  if (targetArgs.length === 0) {
    process.stderr.write('Usage: profile-mutation-workers.js [--interval-ms N] [--reserve-mb N] -- <command> [args...]\n');
    process.exitCode = 1;
    return;
  }
  const cliArgs = argv.slice(0, sepIdx);
  const intervalMs = readNumberFlag(cliArgs, '--interval-ms', DEFAULT_INTERVAL_MS);
  const reserveMb = readNumberFlag(cliArgs, '--reserve-mb', DEFAULT_RESERVE_MB);
  const [command, ...commandArgs] = targetArgs;

  const result = await runProfilingSession(command, commandArgs, intervalMs, REAL_ADAPTERS);
  const report = buildProfilingReport(result.samples, {
    freeRamBytes: os.freemem(),
    coreCount: os.cpus().length,
    reserveBytes: reserveMb * 1024 * 1024,
  });
  printJsonToStdout({ exitCode: result.exitCode, ...report });
}

if (require.main === module) {
  runCliMain(main);
}
