#!/usr/bin/env node
/**
 * BL-658: live night closing ceremony driver. handoffd.bb shells this when
 * the ceremony gate reports mode=ceremony so due nights actually freeze,
 * drain/park, rotate+instruct the documenter, confirm .sent.json, then
 * night-stop — not merely log closing-ceremony-due.
 *
 * Usage: node night-closing-ceremony-run.js [--conf <path>] [--target <path>] [--now <epoch-ms>] [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { atomicWrite } from '../util/atomicWrite';
import { writeControlPauseState } from './telegram-front-desk-bot';
import { evaluateGate } from './night-closing-ceremony-gate';
import {
  advanceNightClosingCeremony,
  briefingInstruction,
  type LiveAction,
  type LiveState,
} from '../quality/nightClosingCeremonyLive';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export type RunDeps = {
  readConf: (confPath: string) => string;
  evaluate: typeof evaluateGate;
  readState: (target: string) => LiveState | null;
  writeState: (target: string, state: LiveState) => void;
  scanInFlight: (target: string) => { count: number; roles: string[] };
  scanHeld: (target: string) => string[];
  readActiveRole: (target: string) => string | null;
  briefingSent: (target: string, dayKey: string) => boolean;
  applyFreeze: (target: string, untilMs: number) => void;
  rotateDocumenter: (target: string) => void;
  instructBriefing: (target: string, dayKey: string) => void;
  nightStop: (target: string) => void;
  surface: (target: string, code: string) => void;
  recordCnp: (target: string, held: string[]) => void;
};

function statePath(target: string): string {
  return path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-state.json');
}

function readLiveState(target: string): LiveState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(target), 'utf8')) as LiveState;
  } catch {
    return null;
  }
}

function writeLiveState(target: string, state: LiveState): void {
  const file = statePath(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
}

function listHandoffs(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((n) => n.endsWith('.handoff'));
}

function scanInFlight(target: string): { count: number; roles: string[] } {
  const rolesRoot = path.join(target, '.swarmforge', 'handoffs');
  // Per-role mailboxes live under worktrees; daemon fixture uses shared inbox.
  const shared = listHandoffs(path.join(rolesRoot, 'inbox', 'in_process'));
  const roles: string[] = [];
  if (shared.length > 0) {
    roles.push('resident');
  }
  // Also scan sibling role worktree markers when roles.tsv lists wt paths —
  // best-effort: count shared in_process as the drain signal.
  return { count: shared.length, roles };
}

function scanHeld(target: string): string[] {
  return listHandoffs(path.join(target, '.swarmforge', 'handoffs', 'inbox', 'new'));
}

function readActiveRole(target: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(target, '.swarmforge', 'mono-router-active-role'), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function briefingSent(target: string, dayKey: string): boolean {
  const sentPath = path.join(target, 'docs', 'briefings', '.sent.json');
  try {
    const sent = JSON.parse(fs.readFileSync(sentPath, 'utf8')) as string[];
    return Array.isArray(sent) && sent.some((name) => name === `${dayKey}.md` || name.startsWith(dayKey));
  } catch {
    return false;
  }
}

function sendHandoffNote(target: string, to: string, message: string): void {
  const draftPath = path.join(os.tmpdir(), `closing-ceremony-${process.pid}-${Math.random().toString(36).slice(2)}.handoff`);
  fs.writeFileSync(
    draftPath,
    `type: note\nto: ${to}\npriority: 00\nmessage: ${message.slice(0, 80)}\n`,
    'utf8'
  );
  const script = path.join(target, 'swarmforge', 'scripts', 'swarm_handoff.sh');
  if (!fs.existsSync(script)) {
    // Fixture roots may lack scripts — write a loud marker instead.
    const marker = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-notes.log');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.appendFileSync(marker, `${to}: ${message}\n`);
    fs.unlinkSync(draftPath);
    return;
  }
  execFileSync(script, [draftPath], {
    cwd: target,
    env: { ...process.env, SWARMFORGE_ROLE: 'coordinator', SWARMFORGE_SKIP_DAEMON: '1' },
    stdio: 'pipe',
  });
}

function applyAction(target: string, action: LiveAction, deps: RunDeps, dryRun: boolean): void {
  if (dryRun) {
    return;
  }
  switch (action.kind) {
    case 'freeze':
      deps.applyFreeze(target, action.untilMs);
      return;
    case 'surface':
      deps.surface(target, action.code);
      return;
    case 'record-cnp':
      deps.recordCnp(target, action.heldParcelIds);
      return;
    case 'rotate-documenter':
      deps.rotateDocumenter(target);
      return;
    case 'instruct-briefing':
      deps.instructBriefing(target, action.dayKey);
      return;
    case 'night-stop':
      deps.nightStop(target);
      return;
    default:
      return;
  }
}

export function buildRealDeps(): RunDeps {
  return {
    readConf: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''),
    evaluate: evaluateGate,
    readState: readLiveState,
    writeState: writeLiveState,
    scanInFlight,
    scanHeld,
    readActiveRole,
    briefingSent,
    applyFreeze: (target, untilMs) => {
      writeControlPauseState(target, { active: true, untilMs }, 'night-closing-ceremony');
    },
    rotateDocumenter: (target) => {
      const rotate = path.join(target, 'swarmforge', 'scripts', 'rotate_to_role.sh');
      if (fs.existsSync(rotate)) {
        try {
          execFileSync('bash', [rotate, 'documenter'], {
            cwd: target,
            env: { ...process.env, SWARMFORGE_ROLE: 'coordinator' },
            stdio: 'pipe',
          });
          return;
        } catch {
          // fall through to note
        }
      }
      sendHandoffNote(target, 'coordinator', 'BL-658: rotate resident to documenter for morning briefing');
    },
    instructBriefing: (target, dayKey) => {
      sendHandoffNote(target, 'documenter', briefingInstruction(dayKey));
    },
    nightStop: (target) => {
      const stopFile = path.join(target, '.swarmforge', 'daemon', 'stop');
      fs.mkdirSync(path.dirname(stopFile), { recursive: true });
      atomicWrite(stopFile, 'closing-ceremony\n');
      const kill = path.join(target, 'swarmforge', 'scripts', 'kill_all_swarm.sh');
      if (fs.existsSync(kill)) {
        try {
          execFileSync('bash', [kill, target], { cwd: target, stdio: 'pipe' });
        } catch {
          // stop file is the durable signal; kill is best-effort
        }
      }
    },
    surface: (target, code) => {
      const log = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-loud.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.appendFileSync(log, `${new Date().toISOString()} ${code}\n`);
    },
    recordCnp: (target, held) => {
      const file = path.join(target, '.swarmforge', 'daemon', 'closing-ceremony-cnp.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, `${JSON.stringify({ heldParcelIds: held, at: Date.now() }, null, 2)}\n`);
    },
  };
}

export function parseArgs(argv: string[]): {
  confPath: string | null;
  target: string | null;
  nowMs: number;
  dryRun: boolean;
} {
  let confPath: string | null = null;
  let target: string | null = null;
  let nowMs = Date.now();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--conf' && argv[i + 1] !== undefined) {
      confPath = argv[++i];
    } else if (argv[i] === '--target' && argv[i + 1] !== undefined) {
      target = argv[++i];
    } else if (argv[i] === '--now' && argv[i + 1] !== undefined) {
      nowMs = Number(argv[++i]);
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { confPath, target, nowMs, dryRun };
}

function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseHmToMs(nowMs: number, hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function runNightClosingCeremony(
  target: string,
  confPath: string,
  nowMs: number,
  deps: RunDeps,
  dryRun = false
): { gateMode: string; advanced: boolean; state: LiveState | null; actions: LiveAction[] } {
  const conf = deps.readConf(confPath);
  const gate = deps.evaluate(conf, nowMs);
  if (gate.mode !== 'ceremony') {
    return { gateMode: gate.mode, advanced: false, state: deps.readState(target), actions: [] };
  }

  const nightKey = localDayKey(nowMs);
  const hardDeadlineMs = parseHmToMs(nowMs, gate.closureStopLocal ?? '06:00');
  const drainBudgetMs = 25 * 60_000;
  const flight = deps.scanInFlight(target);
  const obs = {
    nowMs,
    nightKey,
    dayKey: nightKey,
    ceremonyDue: Boolean(gate.ceremonyDue),
    drainBudgetMs,
    hardDeadlineMs,
    inFlightCount: flight.count,
    activeRole: deps.readActiveRole(target),
    heldParcelIds: deps.scanHeld(target),
    briefingAlreadySent: deps.briefingSent(target, nightKey),
  };

  // Continue in-progress nights even outside the begin window.
  const prev = deps.readState(target);
  if (prev && prev.nightKey === nightKey && prev.phase !== 'done' && prev.phase !== 'idle') {
    obs.ceremonyDue = true;
  }

  const { state, actions } = advanceNightClosingCeremony(prev, obs);
  for (const action of actions) {
    applyAction(target, action, deps, dryRun);
  }
  if (!dryRun) {
    deps.writeState(target, state);
  }
  return { gateMode: gate.mode, advanced: actions.length > 0 || state.phase !== (prev?.phase ?? 'idle'), state, actions };
}

export async function main(): Promise<void> {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const { confPath, target, nowMs, dryRun } = parseArgs(process.argv.slice(2));
  const root = target ?? projectRoot;
  const conf = confPath ?? path.join(projectRoot, 'swarmforge', 'swarmforge.conf');
  const result = runNightClosingCeremony(root, conf, nowMs, buildRealDeps(), dryRun);
  printJsonToStdout(result);
}

if (require.main === module) {
  runCliMain(main);
}
