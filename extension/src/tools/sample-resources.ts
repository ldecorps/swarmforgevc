#!/usr/bin/env node
/**
 * BL-350 (BL-336 finding H1): headless entrypoint for BL-264's resource
 * sampler. The only other caller (extension.ts's startOrRestartResourceSampler)
 * is vscode.*-activation-gated, so a swarm with no editor attached never
 * samples at all and the cost-health sidecar's resourceAnomalies field stays
 * permanently empty. This CLI reuses the same tmux-discovery pid resolution
 * and telemetry writer unchanged (buildSampledRoles, sampleRolesOnce), so it
 * can never disagree with the host-side sampler about what a sample looks
 * like.
 *
 * Usage: node sample-resources.js
 *
 * Gated by shouldSampleThisInterval against the shared telemetry file, not a
 * local timer: whichever caller (this CLI's periodic sweep, or the host's
 * setInterval) last recorded a sample covers the current interval, so an
 * editor being attached at the same time never produces a duplicate sample.
 */
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { readSwarmRoles } from '../swarm/tmuxClient';
import { buildSampledRoles } from '../swarm/resourceSamplerActivation';
import {
  readResourceSampleEvents,
  latestSampleAtMs,
  shouldSampleThisInterval,
  sampleRolesOnce,
  DEFAULT_SAMPLER_INTERVAL_MS,
} from '../metrics/resourceTelemetry';

export function formatSampleResult(sampledCount: number | null): string {
  return sampledCount === null ? 'SKIPPED already sampled this interval' : `SAMPLED ${sampledCount} role(s)`;
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const nowMs = Date.now();
  const lastSampleAtMs = latestSampleAtMs(readResourceSampleEvents(mainWorktreePath));

  if (!shouldSampleThisInterval(lastSampleAtMs, nowMs, DEFAULT_SAMPLER_INTERVAL_MS)) {
    console.log(formatSampleResult(null));
    return;
  }

  const roles = readSwarmRoles(mainWorktreePath);
  const sampledRoles = buildSampledRoles(mainWorktreePath, roles);
  const sampledCount = sampleRolesOnce(mainWorktreePath, sampledRoles, undefined, nowMs);
  console.log(formatSampleResult(sampledCount));
}

if (require.main === module) {
  runCliMain(main);
}
