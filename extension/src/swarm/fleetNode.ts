// BL-246 (Baton fleet epic, BL-242 child): the fleet is a composite of
// swarms. A fleet node rolls up several swarm CompositeNode instances
// (BL-244's createSwarmNode) through the SAME identity/status/health/
// children interface a swarm already uses to roll up its agents - fleet
// -> swarm -> agent, each level answering the same four calls, with no
// special case for a single-swarm fleet (the ticket's own "composite
// uniformity" bar). Reuses compositeNode.ts's rollupStatus unchanged.
//
// PoC transport is POLL ("when the console refreshes"): this module holds
// no subscription/cache state of its own - every call reads whatever its
// given swarm nodes currently report, so "refresh" is simply calling
// identity()/status()/health()/children() again. Push (Observer) is
// deferred to @m2, per the ticket's own scope.

import { CompositeNode, NodeHealth, NodeIdentity, rollupStatus } from './compositeNode';

export interface FleetNodeDeps {
  fleetName: string;
  swarms: CompositeNode[];
}

function rollupHealth(swarms: CompositeNode[]): NodeHealth {
  const initial: NodeHealth = { expected_panes: 0, live_panes: 0, coordinator_alive: true };
  return swarms.reduce((acc: NodeHealth, swarm): NodeHealth => {
    const health = swarm.health();
    return {
      expected_panes: acc.expected_panes + health.expected_panes,
      live_panes: acc.live_panes + health.live_panes,
      coordinator_alive: acc.coordinator_alive && health.coordinator_alive,
    };
  }, initial);
}

export function createFleetNode(deps: FleetNodeDeps): CompositeNode {
  return {
    identity: (): NodeIdentity => ({ name: deps.fleetName, project: '', kind: 'fleet', coordinatorAddress: '' }),
    status: () => rollupStatus(deps.swarms.map((swarm) => swarm.status())),
    health: () => rollupHealth(deps.swarms),
    children: () => deps.swarms,
  };
}
