#!/usr/bin/env node
/**
 * BL-246 (Baton fleet epic, BL-242 child): the fleet console. Two swarms,
 * two projects, one console.
 *
 * BL-437: the console is now a DUMB merger. Each swarm publishes its own
 * rolled-up status.json (emit-fleet-status.ts, run by that swarm's own
 * handoffd every cycle) into the rendezvous dir under the operator host's
 * $HOME; this CLI enumerates that dir, reads each published doc, and
 * merges - it never again reaches into another swarm's roles.tsv/heartbeat
 * files to reconstruct status (BL-246's original design, which needed a
 * hand-authored SwarmRegistration nobody ever actually authored). The
 * roster is "whatever subdirs exist here", not a config file.
 *
 * A swarm whose handoffd has died leaves its published doc's `updated_at`
 * stale - beyond the SAME liveness threshold BL-245 already uses
 * (watchdog/liveness.ts), this console infers 'stopped (coordinator lost)'
 * regardless of whatever status the frozen doc still claims (it was
 * written before the daemon died and can never update itself).
 *
 * PoC transport is POLL ("when the console refreshes"): every call reads
 * fresh on-disk state, so "refresh" is simply running this CLI again.
 * True push (Observer) is @m2, deferred per the ticket's own scope.
 *
 * Usage: node fleet-console.js [rendezvous-dir]
 * (rendezvous-dir defaults to ~/.swarmforge/fleet; override only for
 * tests or an alternate host - never for a real fleet view.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { CompositeNode, NodeHealth, NodeIdentity, NodeStatus, rollupStatus } from '../swarm/compositeNode';
import { createFleetNode } from '../swarm/fleetNode';
import { PublishedNode, PublishedSwarmStatus, fleetRendezvousDir } from './emit-fleet-status';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export interface FleetConsoleArgs {
  rendezvousDir: string;
}

// No required arg any more (BL-437 removed the hand-authored registration
// file this ticket existed to eliminate) - a bare `node fleet-console.js`
// is now the ordinary, complete invocation.
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): FleetConsoleArgs {
  return { rendezvousDir: argv[0] || fleetRendezvousDir(env) };
}

// BL-245's own liveness dead-timeout, reused as the staleness threshold
// here rather than a second, independently-tuned constant for the same
// underlying question ("has this daemon stopped updating its own state").
export const STALE_AFTER_MS = 120_000;

export function isStaleUpdatedAt(updatedAtIso: string, nowMs: number, staleAfterMs: number = STALE_AFTER_MS): boolean {
  const ageMs = nowMs - Date.parse(updatedAtIso);
  return !Number.isFinite(ageMs) || ageMs > staleAfterMs;
}

// BL-437 scenario 02/04: enumerates the rendezvous dir - each subdir IS a
// swarm's own name, and its status.json (or its absence/corruption) is the
// ONLY thing consulted. A missing or malformed doc for one swarm is
// skipped, never crashing the whole fleet render.
export function enumeratePublishedSwarms(rendezvousDir: string): PublishedSwarmStatus[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(rendezvousDir);
  } catch {
    return [];
  }
  const docs: PublishedSwarmStatus[] = [];
  for (const entry of entries) {
    try {
      const raw = fs.readFileSync(path.join(rendezvousDir, entry, 'status.json'), 'utf8');
      docs.push(JSON.parse(raw));
    } catch {
      // no status.json published yet for this subdir, or it is unreadable/
      // malformed - never let one bad swarm doc crash the whole fleet view.
    }
  }
  return docs;
}

function leafNode(node: PublishedNode): CompositeNode {
  return {
    identity: () => node.identity,
    status: () => node.status,
    health: () => node.health,
    children: () => [],
  };
}

// BL-437 scenario 04: every rendered value here is read from a field of
// the published doc - nothing calls back into the swarm's own internal
// role files. Two DERIVED values, both computed purely from the doc's own
// fields: the staleness override (updated_at) and, BL-438, the needs_human
// override (architect bounce 2026-07-16: previously computed and published
// by emit-fleet-status.ts but never actually READ here, so the field was
// dead output). needs_human folds in via rollupStatus - the SAME
// worst-status-wins priority compositeNode.ts already uses to roll up a
// swarm's own pack agents - so a swarm already 'degraded' (worse than
// merely blocked) is never downgraded to 'blocked' just because the
// coordinator is also awaiting a human; 'stopped (coordinator lost)' still
// outranks both.
export function publishedSwarmToNode(doc: PublishedSwarmStatus, nowMs: number): CompositeNode {
  const stale = isStaleUpdatedAt(doc.updated_at, nowMs);
  const statuses: NodeStatus[] = doc.needs_human ? [doc.status, 'blocked'] : [doc.status];
  const status: NodeStatus = stale ? 'stopped (coordinator lost)' : rollupStatus(statuses);
  return {
    identity: () => doc.identity,
    status: () => status,
    health: () => doc.health,
    children: () => doc.children.map(leafNode),
  };
}

export interface RenderedNode {
  identity: NodeIdentity;
  status: NodeStatus;
  health: NodeHealth;
}

export function renderFleet(rendezvousDir: string, nowMs: number = Date.now()) {
  const swarms = enumeratePublishedSwarms(rendezvousDir).map((doc) => publishedSwarmToNode(doc, nowMs));
  const fleet = createFleetNode({ fleetName: 'fleet', swarms });
  return {
    identity: fleet.identity(),
    status: fleet.status(),
    health: fleet.health(),
    swarms: fleet.children().map(
      (swarm): RenderedNode => ({ identity: swarm.identity(), status: swarm.status(), health: swarm.health() })
    ),
  };
}

export const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  printJsonToStdout(renderFleet(args.rendezvousDir));
};

if (require.main === module) {
  runCliMain(main);
}
