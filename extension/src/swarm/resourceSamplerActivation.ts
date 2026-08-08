import { execFileSync } from 'child_process';
import { SwarmRole, readTmuxSocket, getPaneBaseIndex, resolveAgentPaneTarget, getPanePid } from './tmuxClient';
import { SampledRole } from '../metrics/resourceTelemetry';

// BL-264: resolves one role's live pid via the SAME tmux discovery chain
// PaneTailer already uses (readTmuxSocket -> getPaneBaseIndex ->
// resolveAgentPaneTarget -> getPanePid) - reuse, not a second discovery
// path. Recomputed fresh on every call, never cached, so a respawned
// pane's new pid is picked up on the sampler's NEXT tick rather than a pid
// resolved once at start time going stale.
export function resolvePanePid(targetPath: string, session: string): number | null {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return null;
  }
  const paneBaseIndex = getPaneBaseIndex(socketPath);
  const target = resolveAgentPaneTarget(socketPath, session, paneBaseIndex);
  const pidText = getPanePid(socketPath, target);
  if (!pidText) {
    return null;
  }
  const pid = Number(pidText);
  return Number.isFinite(pid) ? pid : null;
}

export interface ProcessTreeEntry {
  pid: number;
  ppid: number;
  command: string;
}

// BL-847: getPanePid (and therefore resolvePanePid above) names the pane's
// ROOT SHELL - the process tmux itself forked - never the agent that shell
// went on to exec/spawn. Every rssBytes/cpuPercent sample must describe the
// process actually doing the role's work, so the sampler resolves through
// this instead: the pane pid's own descendants, none of which is the pane
// pid itself.

// Thin OS adapter: the whole process table in one shell-out (never one
// `ps` call per candidate pid) so selectAgentDescendant below can walk an
// arbitrary depth of descendants purely in-memory. `-A` (BSD, and accepted
// by Linux procps as a synonym for `-e`) lists every process regardless of
// controlling terminal - the target macOS/Linux-only surface this project
// already commits to (local-engineering.prompt).
export function listProcessTree(): ProcessTreeEntry[] {
  try {
    const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) {
          return null;
        }
        return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
      })
      .filter((entry): entry is ProcessTreeEntry => entry !== null);
  } catch {
    return [];
  }
}

export const DEFAULT_AGENT_COMMAND_NAME = 'claude';

// Pure: BFS from rootPid (excluded - only its descendants are candidates)
// over an already-resolved process table, returning the first descendant,
// nearest generation first, whose command matches agentCommandName. null
// when the tree has no such descendant - the caller must never fall back
// to rootPid itself (that is precisely the wrong-process bug this ticket
// fixes).
export function selectAgentDescendant(
  processTree: ProcessTreeEntry[],
  rootPid: number,
  agentCommandName: string
): number | null {
  const childrenByPpid = new Map<number, ProcessTreeEntry[]>();
  for (const entry of processTree) {
    const siblings = childrenByPpid.get(entry.ppid) ?? [];
    siblings.push(entry);
    childrenByPpid.set(entry.ppid, siblings);
  }
  const queue: ProcessTreeEntry[] = [...(childrenByPpid.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    if (candidate.command === agentCommandName) {
      return candidate.pid;
    }
    queue.push(...(childrenByPpid.get(candidate.pid) ?? []));
  }
  return null;
}

// Composes resolvePanePid (the pane's shell) with selectAgentDescendant
// (the shell's own agent descendant, by configured command name - the
// human-approved resolution recorded in this ticket's approval_context).
// null whenever either step cannot resolve - never a fallback to the shell
// pid, per invariant 2 ("record no sample at all rather than a sample of
// the wrong process").
export function resolveAgentPid(
  targetPath: string,
  session: string,
  agentCommandName: string = DEFAULT_AGENT_COMMAND_NAME,
  getProcessTree: () => ProcessTreeEntry[] = listProcessTree
): number | null {
  const panePid = resolvePanePid(targetPath, session);
  if (panePid === null) {
    return null;
  }
  return selectAgentDescendant(getProcessTree(), panePid, agentCommandName);
}

// Pure given resolvePid (defaults to the real resolveAgentPid above - the
// agent process, not the pane's root shell): maps each discovered SwarmRole
// into the SampledRole shape startResourceSampler expects. getPid is a
// LAZY closure - not resolved here - so each sampler tick re-resolves the
// live pid rather than one captured at wiring time. Each role's OWN
// swarmRole.agent (aider/claude/codex/copilot/grok - see agentPaneState.ts)
// is threaded through as the third arg so a non-claude role's sampler
// looks for ITS configured agent name, never a hardcoded 'claude' that
// would silently zero out every non-claude role's samples.
export function buildSampledRoles(
  targetPath: string,
  roles: SwarmRole[],
  resolvePid: (targetPath: string, session: string, agentCommandName: string) => number | null = resolveAgentPid
): SampledRole[] {
  return roles.map((swarmRole) => ({
    role: swarmRole.role,
    getPid: () => resolvePid(targetPath, swarmRole.session, swarmRole.agent),
  }));
}
