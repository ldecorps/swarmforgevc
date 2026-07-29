// BL-702: execute helpers for Cursor Remote operator verbs (slice 1).
// Pure-ish where possible; spawn/fs effects stay here so Live stays thin.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSwarmEnvFile } from './swarmEnv';
import { startRedeployRun, formatRedeployStartMessage, formatRedeployFailureMessage } from './telegramCursorBridgeRedeploy';
import {
  startMiniAppRedeployRun,
  formatMiniAppRedeployStartMessage,
  formatMiniAppRedeployFailureMessage,
} from './telegramCursorBridgeMiniAppRedeploy';
import { readBacklogFolders } from '../panel/backlogReader';
import {
  selectAutopilotQueue,
  selectLandQueue,
  formatDryRunList,
  type OperatorQueueTicket,
} from './telegramCursorOperatorQueue';
import {
  probeSwarmLiveness,
  fullPackPipelineRolesUp,
  formatFullPackRefuse,
} from './telegramCursorOperatorLiveness';
import {
  readOperatorPolicy,
  writeOperatorPolicy,
  parseHolidayAddArgs,
  formatHolidayList,
  formatShiftStatus,
  formatOncallAlertLine,
  applyHolidayAdd,
  applyHolidayClear,
  applyShiftStart,
  applyShiftEnd,
  applyOncall,
} from './telegramCursorOperatorPolicy';
import { readPipelineStages } from '../swarm/swarmState';

function bounceSentinelPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'bounce');
}

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Twin of Control writeBounceSentinel — scope swarm | extension | all. */
export function writeOperatorBounceSentinel(
  repoRoot: string,
  scope: 'swarm' | 'extension' | 'all' = 'swarm'
): void {
  atomicWrite(bounceSentinelPath(repoRoot), scope);
}

export function formatSyncenvReport(repoRoot: string): string {
  const keys = Object.keys(loadSwarmEnvFile(repoRoot)).sort();
  if (keys.length === 0) {
    return 'syncenv: .swarmforge/swarm.env missing or empty (no keys).';
  }
  const lines = keys.map((k) => `- ${k}: present`);
  return ['syncenv: key presence (values never shown)', ...lines].join('\n');
}

export function runCompileOnly(repoRoot: string): string {
  const result = spawnSync('npm', ['run', 'compile'], {
    cwd: path.join(repoRoot, 'extension'),
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  });
  if (result.status === 0) {
    return 'compile: ok';
  }
  const err = (result.stderr || result.stdout || result.error?.message || 'compile failed').trim();
  return `compile: failed\n${err.slice(0, 1500)}`;
}

export function runPullFfOnly(repoRoot: string): string {
  const result = spawnSync('git', ['pull', '--ff-only'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) {
    const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const short = (sha.stdout ?? '').trim() || '(unknown)';
    return `pull: ok at ${short}\n${out.slice(0, 800)}`;
  }
  return `pull: refused or failed\n${out.slice(0, 1500)}`;
}

export function formatDoctorReport(repoRoot: string): string {
  const lines: string[] = ['doctor:'];
  const swarmEnv = loadSwarmEnvFile(repoRoot);
  lines.push(`- swarm.env keys: ${Object.keys(swarmEnv).length}`);
  const bridgeHb = path.join(repoRoot, '.swarmforge', 'operator', 'cursor-bridge-heartbeat.json');
  lines.push(`- cursor-bridge heartbeat: ${fs.existsSync(bridgeHb) ? 'present' : 'missing'}`);
  const tunnel = path.join(repoRoot, '.swarmforge', 'operator', 'telegram-console.status.json');
  lines.push(`- tunnel status file: ${fs.existsSync(tunnel) ? 'present' : 'missing'}`);
  const git = spawnSync('git', ['status', '-sb'], { cwd: repoRoot, encoding: 'utf8' });
  lines.push(`- git: ${(git.stdout ?? git.stderr ?? 'n/a').trim().split('\n')[0] ?? 'n/a'}`);
  return lines.join('\n');
}

export function formatTunnelReport(repoRoot: string): string {
  const tunnelPath = path.join(repoRoot, '.swarmforge', 'operator', 'telegram-console.status.json');
  if (!fs.existsSync(tunnelPath)) {
    return 'tunnel: no telegram-console.status.json';
  }
  try {
    const raw = JSON.parse(fs.readFileSync(tunnelPath, 'utf8')) as Record<string, unknown>;
    const keys = Object.keys(raw).filter((k) => !/token|secret|password|key/i.test(k));
    const summary = keys
      .slice(0, 12)
      .map((k) => {
        const v = raw[k];
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          return `- ${k}: ${String(v)}`;
        }
        return `- ${k}: <object>`;
      });
    return ['tunnel:', ...summary].join('\n');
  } catch (err) {
    return `tunnel: failed to read status (${err instanceof Error ? err.message : String(err)})`;
  }
}

function ensureLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'cursor-remote-ensure.lock');
}

/** Single-flight gate for /ensure (BL-702 hard verb). */
export function tryAcquireEnsureLock(repoRoot: string, nowMs: number = Date.now()): boolean {
  const lockPath = ensureLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    if (fs.existsSync(lockPath)) {
      const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { startedAtMs?: number; pid?: number };
      const age = nowMs - (typeof raw.startedAtMs === 'number' ? raw.startedAtMs : 0);
      // Stale after 3 minutes — allow retry if a prior ensure hung.
      if (age >= 0 && age < 180_000) {
        return false;
      }
    }
  } catch {
    // corrupt lock → take over
  }
  atomicWrite(lockPath, JSON.stringify({ startedAtMs: nowMs, pid: process.pid }));
  return true;
}

export function releaseEnsureLock(repoRoot: string): void {
  try {
    fs.unlinkSync(ensureLockPath(repoRoot));
  } catch {
    // absent is fine
  }
}

export function runEnsure(repoRoot: string, opts?: { principalId?: string }): string {
  if (!tryAcquireEnsureLock(repoRoot)) {
    return 'ensure: refused — already in flight (single-flight).';
  }
  try {
    const swarm = path.join(repoRoot, 'swarm');
    const script = fs.existsSync(swarm) ? swarm : path.join(repoRoot, 'swarmforge.sh');
    const result = spawnSync(script, ['ensure'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...loadSwarmEnvFile(repoRoot) },
      timeout: 180_000,
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const oncall = formatOncallAlertLine(readOperatorPolicy(repoRoot), opts?.principalId);
    if (result.status === 0) {
      return `ensure: ok (${oncall})\n${out.slice(0, 1200)}`;
    }
    return `ensure: failed (exit ${result.status}; ${oncall})\n${out.slice(0, 1500)}`;
  } finally {
    releaseEnsureLock(repoRoot);
  }
}

function controlPausePath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'control-pause.json');
}

/** Twin of Control writeControlPauseState — freezes promotion, not process kill. */
export function writeOperatorPauseState(
  repoRoot: string,
  state: { active: boolean; untilMs?: number }
): void {
  const payload = state.active
    ? { active: true, ...(state.untilMs !== undefined ? { untilMs: state.untilMs } : {}) }
    : { active: false };
  atomicWrite(controlPausePath(repoRoot), JSON.stringify(payload));
}

export function readOperatorPauseState(repoRoot: string): { active: boolean; untilMs?: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(controlPausePath(repoRoot), 'utf8')) as {
      active?: boolean;
      untilMs?: number;
    };
    return parsed.active ? { active: true, untilMs: parsed.untilMs } : { active: false };
  } catch {
    return { active: false };
  }
}

export function killAllSwarmScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'kill_all_swarm.sh');
}

/** Sync twin of Control runKillAllSwarm — used after /stop hard confirm. */
export function runOperatorStop(repoRoot: string): string {
  const script = killAllSwarmScriptPath(repoRoot);
  if (!fs.existsSync(script)) {
    return `stop: kill_all_swarm.sh missing at ${script}`;
  }
  const result = spawnSync('bash', [script, repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...loadSwarmEnvFile(repoRoot) },
    timeout: 120_000,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) {
    return `stop: complete (kill_all_swarm).\n${out.slice(0, 800)}`;
  }
  return `stop: reported error (exit ${result.status})\n${out.slice(0, 1500)}`;
}

/** /start — bounce sentinel so owning context relaunches with swarm.env merge. */
export function runOperatorStart(repoRoot: string): string {
  writeOperatorBounceSentinel(repoRoot, 'swarm');
  return 'start: bounce sentinel written (swarm). Relaunch merges swarm.env via buildLaunchEnv.';
}

function parseBounceScope(args?: string): 'swarm' | 'extension' | 'bridge' | 'all' {
  const scope = (args ?? 'swarm').trim().toLowerCase().split(/\s+/)[0] || 'swarm';
  if (scope === 'extension' || scope === 'bridge' || scope === 'all' || scope === 'swarm') {
    return scope;
  }
  return 'swarm';
}

export type OperatorExecuteResult = {
  text: string;
  wroteBounceSentinel: boolean;
  /** BL-703: start sequential Cursor /pilot for these tickets after the reply. */
  pilotQueue?: string[];
  /** BL-703: after land queue empties, ask drain-stop. */
  askLandSleep?: boolean;
  /** BL-703: start hydrate/mint Cursor prompt for this target. */
  hydrateTarget?: string;
  hydrateMode?: 'hydrate' | 'mint';
};

function loadQueueTickets(repoRoot: string): OperatorQueueTicket[] {
  const folders = readBacklogFolders(path.join(repoRoot, 'backlog'));
  const out: OperatorQueueTicket[] = [];
  for (const folder of ['active', 'paused', 'hold', 'done'] as const) {
    for (const item of folders[folder] ?? []) {
      out.push({
        id: item.id,
        title: item.title,
        type: item.type,
        severity: item.severity,
        priority: item.priority,
        humanApproval: item.humanApproval,
        acceptance: item.acceptance,
        folder,
      });
    }
  }
  return out;
}

/** Ticket ids currently held in a pipeline parcel / holding window. */
export function parcelTicketIds(repoRoot: string): string[] {
  try {
    const stages = readPipelineStages(repoRoot);
    const ids = new Set<string>();
    for (const stage of stages) {
      for (const id of stage.heldTicketIds ?? []) {
        if (id) {
          ids.add(id.toUpperCase());
        }
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

function executeAutopilot(repoRoot: string, args?: string): OperatorExecuteResult {
  const queue = selectAutopilotQueue(loadQueueTickets(repoRoot));
  const dry = (args ?? '').trim().toLowerCase().startsWith('dry');
  if (dry) {
    return { text: formatDryRunList('autopilot dry', queue), wroteBounceSentinel: false };
  }
  if (queue.length === 0) {
    return { text: 'autopilot: queue empty (no already-specced high/critical or defect tickets).', wroteBounceSentinel: false };
  }
  return {
    text: `autopilot: starting ${queue.length} ticket(s) sequentially as /pilot.\n${formatDryRunList('queue', queue)}`,
    wroteBounceSentinel: false,
    pilotQueue: queue.map((t) => t.id),
  };
}

function executeLand(repoRoot: string, args?: string): OperatorExecuteResult {
  const queue = selectLandQueue(loadQueueTickets(repoRoot), parcelTicketIds(repoRoot));
  const dry = (args ?? '').trim().toLowerCase().startsWith('dry');
  if (dry) {
    return { text: formatDryRunList('land dry', queue), wroteBounceSentinel: false };
  }
  if (queue.length === 0) {
    return {
      text: 'land: no in-flight tickets. Ask whether to drain-stop?',
      wroteBounceSentinel: false,
      askLandSleep: true,
    };
  }
  return {
    text: `land: piloting ${queue.length} in-flight ticket(s) clear.\n${formatDryRunList('in-flight', queue)}`,
    wroteBounceSentinel: false,
    pilotQueue: queue.map((t) => t.id),
    askLandSleep: true,
  };
}

function executeHydrate(repoRoot: string, verb: 'hydrate' | 'mint', args?: string): OperatorExecuteResult {
  const snap = probeSwarmLiveness(repoRoot);
  const up = fullPackPipelineRolesUp(snap);
  if (up.length > 0) {
    return { text: formatFullPackRefuse(up, `/${verb}`), wroteBounceSentinel: false };
  }
  const target = (args ?? '').trim();
  if (!target) {
    return { text: `/${verb}: need an INTAKE file or BL-xxx target.`, wroteBounceSentinel: false };
  }
  return {
    text: `${verb}: starting specifier-only wake for ${target} (stop on handoff to coder).`,
    wroteBounceSentinel: false,
    hydrateTarget: target,
    hydrateMode: verb,
  };
}

function executePolicyVerb(repoRoot: string, verb: string, args?: string, principalId?: string): OperatorExecuteResult {
  let state = readOperatorPolicy(repoRoot);
  const a = (args ?? '').trim();
  const lower = a.toLowerCase();

  if (verb === '/holiday') {
    if (lower.startsWith('list') || a === '') {
      return { text: formatHolidayList(state), wroteBounceSentinel: false };
    }
    if (lower.startsWith('add')) {
      const parsed = parseHolidayAddArgs(a.replace(/^add\s+/i, ''));
      if ('error' in parsed) {
        return { text: parsed.error, wroteBounceSentinel: false };
      }
      state = applyHolidayAdd(state, parsed);
      writeOperatorPolicy(repoRoot, state);
      return { text: `holiday added: ${parsed.start} → ${parsed.end}`, wroteBounceSentinel: false };
    }
    if (lower.startsWith('clear')) {
      const day = a.replace(/^clear\s+/i, '').trim().split(/\s+/)[0];
      if (!day) {
        return { text: 'usage: /holiday clear YYYY-MM-DD', wroteBounceSentinel: false };
      }
      state = applyHolidayClear(state, day);
      writeOperatorPolicy(repoRoot, state);
      return { text: `holiday clear: removed ranges covering ${day}`, wroteBounceSentinel: false };
    }
    return { text: 'usage: /holiday add|list|clear …', wroteBounceSentinel: false };
  }

  if (verb === '/shift') {
    if (lower.startsWith('status') || a === '') {
      return { text: formatShiftStatus(state), wroteBounceSentinel: false };
    }
    if (lower.startsWith('start')) {
      const rest = a.replace(/^start\s+/i, '').trim().split(/\s+/);
      const name = rest[0] || 'default';
      const until = rest[1];
      state = applyShiftStart(state, name, until);
      writeOperatorPolicy(repoRoot, state);
      return { text: `shift started: ${name}${until ? ` until ${until}` : ''}`, wroteBounceSentinel: false };
    }
    if (lower.startsWith('end')) {
      state = applyShiftEnd(state);
      writeOperatorPolicy(repoRoot, state);
      return { text: 'shift ended.', wroteBounceSentinel: false };
    }
    return { text: 'usage: /shift status|start|end …', wroteBounceSentinel: false };
  }

  if (verb === '/oncall') {
    if (lower === 'off') {
      state = applyOncall(state, undefined);
      writeOperatorPolicy(repoRoot, state);
      return { text: 'oncall: cleared.', wroteBounceSentinel: false };
    }
    if (lower === 'me' || lower === '') {
      const id = principalId || 'principal';
      state = applyOncall(state, id);
      writeOperatorPolicy(repoRoot, state);
      return { text: `oncall: alerts target ${id}`, wroteBounceSentinel: false };
    }
    state = applyOncall(state, a);
    writeOperatorPolicy(repoRoot, state);
    return { text: `oncall: alerts target ${a}`, wroteBounceSentinel: false };
  }

  return { text: `${verb}: unknown policy verb`, wroteBounceSentinel: false };
}

/**
 * Run a confirmed (or read-tier) operator verb. Never returns secret values.
 */
export function executeOperatorVerb(
  repoRoot: string,
  verb: string,
  args?: string,
  opts?: { principalId?: string }
): OperatorExecuteResult {
  const v = verb.toLowerCase();
  if (v === '/syncenv') {
    return { text: formatSyncenvReport(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/compile') {
    return { text: runCompileOnly(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/pull') {
    return { text: runPullFfOnly(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/doctor') {
    return { text: formatDoctorReport(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/tunnel') {
    return { text: formatTunnelReport(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/ensure') {
    return { text: runEnsure(repoRoot, { principalId: opts?.principalId }), wroteBounceSentinel: false };
  }
  if (v === '/restart') {
    writeOperatorBounceSentinel(repoRoot, 'swarm');
    return { text: 'restart: bounce sentinel written (swarm). Relaunch merges swarm.env via buildLaunchEnv.', wroteBounceSentinel: true };
  }
  if (v === '/bounce') {
    const scope = parseBounceScope(args);
    if (scope === 'bridge') {
      const result = startRedeployRun(repoRoot);
      const text = result.ok ? formatRedeployStartMessage(result) : formatRedeployFailureMessage(result);
      return { text: `bounce bridge → ${text}`, wroteBounceSentinel: false };
    }
    const mapped = scope === 'all' ? 'all' : scope === 'extension' ? 'extension' : 'swarm';
    writeOperatorBounceSentinel(repoRoot, mapped);
    return {
      text: `bounce ${scope}: sentinel written (${mapped}). Child relaunch merges swarm.env.`,
      wroteBounceSentinel: true,
    };
  }
  if (v === '/redeploy') {
    const mini = (args ?? '').toLowerCase().includes('mini');
    if (mini) {
      const result = startMiniAppRedeployRun(repoRoot);
      const text = result.ok
        ? formatMiniAppRedeployStartMessage(result)
        : formatMiniAppRedeployFailureMessage(result);
      return { text, wroteBounceSentinel: false };
    }
    const result = startRedeployRun(repoRoot);
    const text = result.ok ? formatRedeployStartMessage(result) : formatRedeployFailureMessage(result);
    return { text, wroteBounceSentinel: false };
  }
  if (v === '/stop') {
    return { text: runOperatorStop(repoRoot), wroteBounceSentinel: false };
  }
  if (v === '/pause') {
    writeOperatorPauseState(repoRoot, { active: true });
    return {
      text: 'pause: new work will not be promoted until /resume. In-flight work continues.',
      wroteBounceSentinel: false,
    };
  }
  if (v === '/resume') {
    writeOperatorPauseState(repoRoot, { active: false });
    return { text: 'resume: new work will be promoted again.', wroteBounceSentinel: false };
  }
  if (v === '/start') {
    return { text: runOperatorStart(repoRoot), wroteBounceSentinel: true };
  }
  if (v === '/autopilot') {
    return executeAutopilot(repoRoot, args);
  }
  if (v === '/land') {
    return executeLand(repoRoot, args);
  }
  if (v === '/hydrate' || v === '/mint') {
    return executeHydrate(repoRoot, v === '/mint' ? 'mint' : 'hydrate', args);
  }
  if (v === '/shift' || v === '/holiday' || v === '/oncall') {
    return executePolicyVerb(repoRoot, v, args, opts?.principalId);
  }
  return { text: `${v}: no Cursor Remote execute handler yet.`, wroteBounceSentinel: false };
}
