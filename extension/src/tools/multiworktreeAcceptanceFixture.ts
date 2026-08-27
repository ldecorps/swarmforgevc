/**
 * BL-731: pure helpers for the pilot acceptance gate's multi-worktree fixture
 * contract on lifecycle/teardown-class tickets. Side effects (git worktree
 * list, ps probes) stay in pilot-acceptance-gate.ts; this module is the
 * decision logic only.
 */
import * as path from 'path';

export interface MultiworktreeFixtureMetadata {
  worktreeCount: number;
  siblingHandoffdRoots: string[];
  pilotRoot: string;
}

export interface MultiworktreeFixtureAssessment {
  satisfied: boolean;
  metadata: MultiworktreeFixtureMetadata;
}

const LIFECYCLE_TEARDOWN_RE =
  /(?:\b(?:lifecycle|teardown)\b|kill_pipeline|kill[-_]all|stop[-_]swarm|start[-_]swarm|babysitter|ancillary|handoffd_supervisor|pipeline[-_]survivor|stack[-_]survivor)/i;

const LIFECYCLE_SCRIPT_WIRING_RE = /swarmforge\/scripts\/.*\.(sh|bb)/i;

// A ticket is lifecycle/teardown-class when its acceptance path or
// required_wiring names lifecycle scripts or teardown paths — the same
// class BL-637/730/782 belong to, not every ticket in the repo.
export function isLifecycleTeardownTicket(
  acceptance: string | undefined,
  requiredWiring: string[] | undefined
): boolean {
  if (acceptance && LIFECYCLE_TEARDOWN_RE.test(acceptance)) {
    return true;
  }
  if (!requiredWiring) {
    return false;
  }
  return requiredWiring.some((entry) => LIFECYCLE_TEARDOWN_RE.test(entry) && LIFECYCLE_SCRIPT_WIRING_RE.test(entry));
}

export function assessMultiworktreeFixture(
  pilotRoot: string,
  worktreePaths: string[],
  handoffdRoots: string[]
): MultiworktreeFixtureAssessment {
  const normalizedPilot = path.resolve(pilotRoot);
  const distinctWorktrees = [...new Set(worktreePaths.map((entry) => path.resolve(entry)))];
  const siblingHandoffdRoots = [...new Set(handoffdRoots.map((entry) => path.resolve(entry)))].filter(
    (root) => root !== normalizedPilot
  );
  const metadata: MultiworktreeFixtureMetadata = {
    worktreeCount: distinctWorktrees.length,
    siblingHandoffdRoots,
    pilotRoot: normalizedPilot,
  };
  return {
    satisfied: distinctWorktrees.length >= 2 && siblingHandoffdRoots.length >= 1,
    metadata,
  };
}

// Trailing space after handoffd.bb avoids matching handoffd_supervisor.bb
// (same idiom as expedite_cli.bb probe-liveness, BL-782).
const HANDOFFD_ROOT_RE = /handoffd\.bb\s+(\/\S+)/;

export function extractHandoffdRootsFromPs(psOutput: string): string[] {
  const roots = new Set<string>();
  for (const line of psOutput.split('\n')) {
    if (!line.includes('handoffd.bb ')) {
      continue;
    }
    const match = line.match(HANDOFFD_ROOT_RE);
    if (match) {
      roots.add(path.resolve(match[1]));
    }
  }
  return [...roots];
}

export const MULTIWORKTREE_REQUIRED_REFUSAL =
  'single-worktree-only acceptance is insufficient for lifecycle/teardown tickets';
