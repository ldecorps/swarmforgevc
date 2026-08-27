// BL-1170: /postmortem operator verb — qualify outage, teach babysitter + playbook.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export const FAILURE_CLASS_REGISTRY_REL = '.swarmforge/babysitter/failure-classes.json';
export const PLAYBOOK_REL = '.swarmforge/operator/failure-class-playbooks.json';
export const DISASTER_INCIDENTS_REL = '.swarmforge/incidents/disaster-incidents.json';
export const POSTMORTEM_STATE_REL = '.swarmforge/operator/postmortem-state.json';
export const QUALIFIED_RECORDS_REL = '.swarmforge/operator/postmortem-records';

export const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type SuggestedAction = { action: string; owner: 'babysitterd' | 'operator' | 'human' };

export type DisasterIncident = {
  id: string;
  status: 'open' | 'cleared';
  opened_at: string;
  cleared_at?: string;
  failure_class?: string;
  likely_causes?: string[];
  evidence_paths?: string[];
  correlated_keys?: string[];
  handoffd_startup_error?: string;
  postmortem_key?: string;
};

export type QualifiedPostmortemRecord = {
  incident_id: string;
  failure_class: string;
  likely_causes: string[];
  evidence_paths: string[];
  postmortem_bundle_path?: string;
  qualified_at: string;
};

export type PostmortemOutcome =
  | {
      outcome: 'ok';
      failure_class: string;
      intakePath: string;
      registryUpdated: boolean;
      playbookUpdated: boolean;
      qualified: QualifiedPostmortemRecord;
    }
  | { outcome: 'refused'; reason: string };

type FailureClassRegistry = {
  classes: Record<
    string,
    {
      correlated_keys: string[];
      rollup_token: string;
      updated_at: string;
      incident_ids: string[];
    }
  >;
};

type PlaybookEntry = {
  suggested_actions: SuggestedAction[];
  summary: string;
  human_hotfix_required?: boolean;
  updated_at: string;
};

type PlaybookStore = Record<string, PlaybookEntry>;

type PostmortemState = { completed: Record<string, string> };

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function parseIncidentTime(iso: string | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function incidentPostmortemKey(incident: DisasterIncident): string {
  if (incident.postmortem_key) {
    return incident.postmortem_key;
  }
  const fc = incident.failure_class ?? inferFailureClass(incident);
  return `${fc}:${incident.opened_at}`;
}

export function inferFailureClass(incident: DisasterIncident): string {
  if (incident.failure_class) {
    return incident.failure_class;
  }
  if (incident.handoffd_startup_error) {
    return 'handoffd-parse-dead';
  }
  const keys = incident.correlated_keys ?? [];
  const halfLaunch = keys.filter((k) => k.startsWith('proc-')).length;
  if (keys.includes('handoffd') && keys.includes('swarm-starved') && halfLaunch >= 3) {
    return 'starvation-cascade';
  }
  return 'unknown-disaster';
}

function defaultLikelyCauses(failureClass: string, incident: DisasterIncident): string[] {
  if (incident.likely_causes?.length) {
    return incident.likely_causes;
  }
  if (failureClass === 'handoffd-parse-dead') {
    return [incident.handoffd_startup_error ?? 'handoffd failed to start'];
  }
  if (failureClass === 'starvation-cascade') {
    return [
      'handoffd not running blocks delivery and respawn',
      'multiple role panes are half-launched (agent gone, shell up)',
      'swarm mailboxes are starved with work pending',
    ];
  }
  return ['disaster incident cleared; root cause not yet classified'];
}

function defaultEvidencePaths(incident: DisasterIncident): string[] {
  if (incident.evidence_paths?.length) {
    return incident.evidence_paths;
  }
  return ['.swarmforge/daemon/handoffd.log', '.swarmforge/babysitterd/streak', '.swarmforge/incidents/control-plane.json'];
}

function defaultPlaybook(failureClass: string, incident: DisasterIncident): PlaybookEntry {
  if (failureClass === 'handoffd-parse-dead') {
    const logPath = incident.evidence_paths?.[0] ?? '.swarmforge/daemon/handoffd.log';
    return {
      suggested_actions: [{ action: `inspect ${logPath} and apply a human hotfix`, owner: 'human' }],
      summary: 'handoffd parse/dead — human hotfix required',
      human_hotfix_required: true,
      updated_at: new Date().toISOString(),
    };
  }
  return {
    suggested_actions: [
      { action: 'run ./swarm ensure once', owner: 'babysitterd' },
      { action: 'inspect handoffd.log last 20 lines', owner: 'operator' },
      { action: 'confirm agents respawned after ensure', owner: 'human' },
    ],
    summary: `${failureClass}: follow the updated operator playbook`,
    human_hotfix_required: false,
    updated_at: new Date().toISOString(),
  };
}

function defaultCorrelatedKeys(failureClass: string, incident: DisasterIncident): string[] {
  if (incident.correlated_keys?.length) {
    return incident.correlated_keys;
  }
  if (failureClass === 'handoffd-parse-dead') {
    return ['handoffd'];
  }
  return ['handoffd', 'swarm-starved', 'proc-*'];
}

function runCollectDaemonPostmortem(repoRoot: string): string | undefined {
  const script = path.join(repoRoot, 'swarmforge', 'scripts', 'collect_daemon_postmortem.sh');
  if (!fs.existsSync(script)) {
    return undefined;
  }
  const result = spawnSync('bash', [script, repoRoot], { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) {
    return undefined;
  }
  const match = (result.stdout ?? '').match(/postmortem-[^\s]+\.log/);
  return match ? path.join('.swarmforge', 'daemon', match[0]) : undefined;
}

function matchesArgs(incident: DisasterIncident, args: string | undefined): boolean {
  const trimmed = (args ?? '').trim();
  if (!trimmed) {
    return true;
  }
  const fc = inferFailureClass(incident);
  return incident.id === trimmed || fc === trimmed;
}

export function findRecentClearedIncident(
  repoRoot: string,
  args: string | undefined,
  nowMs: number = Date.now(),
  lookbackMs: number = DEFAULT_LOOKBACK_MS
): DisasterIncident | undefined {
  const incidents = readJsonFile<DisasterIncident[]>(path.join(repoRoot, DISASTER_INCIDENTS_REL), []);
  const cutoff = nowMs - lookbackMs;
  const candidates = incidents
    .filter((i) => i.status === 'cleared')
    .filter((i) => parseIncidentTime(i.cleared_at ?? i.opened_at) >= cutoff)
    .filter((i) => matchesArgs(i, args))
    .sort((a, b) => parseIncidentTime(b.cleared_at ?? b.opened_at) - parseIncidentTime(a.cleared_at ?? a.opened_at));
  return candidates[0];
}

function alreadyCompleted(repoRoot: string, key: string): boolean {
  const state = readJsonFile<PostmortemState>(path.join(repoRoot, POSTMORTEM_STATE_REL), { completed: {} });
  return Boolean(state.completed[key]);
}

function markCompleted(repoRoot: string, key: string): void {
  const filePath = path.join(repoRoot, POSTMORTEM_STATE_REL);
  const state = readJsonFile<PostmortemState>(filePath, { completed: {} });
  state.completed[key] = new Date().toISOString();
  atomicWriteJson(filePath, state);
}

function updateRegistry(repoRoot: string, failureClass: string, incident: DisasterIncident): boolean {
  const filePath = path.join(repoRoot, FAILURE_CLASS_REGISTRY_REL);
  const store = readJsonFile<FailureClassRegistry>(filePath, { classes: {} });
  const existing = store.classes[failureClass];
  const incidentIds = new Set(existing?.incident_ids ?? []);
  incidentIds.add(incident.id);
  store.classes[failureClass] = {
    correlated_keys: defaultCorrelatedKeys(failureClass, incident),
    rollup_token: 'disaster-class',
    updated_at: new Date().toISOString(),
    incident_ids: [...incidentIds],
  };
  atomicWriteJson(filePath, store);
  return true;
}

function updatePlaybook(repoRoot: string, failureClass: string, incident: DisasterIncident): boolean {
  const filePath = path.join(repoRoot, PLAYBOOK_REL);
  const store = readJsonFile<PlaybookStore>(filePath, {});
  store[failureClass] = defaultPlaybook(failureClass, incident);
  atomicWriteJson(filePath, store);
  return true;
}

function writeQualifiedRecord(repoRoot: string, record: QualifiedPostmortemRecord): void {
  const dir = path.join(repoRoot, QUALIFIED_RECORDS_REL);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, `${record.incident_id}.json`), record);
}

function mintIntakeStub(repoRoot: string, failureClass: string, record: QualifiedPostmortemRecord): string {
  const stamp = record.qualified_at.replace(/[:.]/g, '').replace('Z', 'Z');
  const fileName = `INTAKE-disaster-${failureClass}-${stamp}.md`;
  const intakePath = path.join(repoRoot, 'backlog', fileName);
  fs.mkdirSync(path.dirname(intakePath), { recursive: true });
  const body = [
    `# INTAKE — disaster learn stub (${failureClass})`,
    '',
    `**Qualified at:** ${record.qualified_at}`,
    `**Incident:** ${record.incident_id}`,
    '',
    '## failure_class',
    failureClass,
    '',
    '## likely_causes',
    ...record.likely_causes.map((c) => `- ${c}`),
    '',
    '## evidence_paths',
    ...record.evidence_paths.map((p) => `- ${p}`),
    '',
    '## open_questions',
    '- Specifier: promote to backlog ticket if a durable code change is needed (BL-311).',
    '',
  ].join('\n');
  fs.writeFileSync(intakePath, body, 'utf8');
  return path.join('backlog', fileName);
}

export function runOperatorPostmortem(
  repoRoot: string,
  args?: string,
  opts?: { nowMs?: number; lookbackMs?: number }
): PostmortemOutcome {
  const incident = findRecentClearedIncident(repoRoot, args, opts?.nowMs, opts?.lookbackMs);
  if (!incident) {
    return { outcome: 'refused', reason: 'nothing to postmortem' };
  }
  const key = incidentPostmortemKey(incident);
  if (alreadyCompleted(repoRoot, key)) {
    return { outcome: 'refused', reason: 'nothing to postmortem' };
  }
  const failureClass = inferFailureClass(incident);
  const qualified: QualifiedPostmortemRecord = {
    incident_id: incident.id,
    failure_class: failureClass,
    likely_causes: defaultLikelyCauses(failureClass, incident),
    evidence_paths: defaultEvidencePaths(incident),
    postmortem_bundle_path: runCollectDaemonPostmortem(repoRoot),
    qualified_at: new Date(opts?.nowMs ?? Date.now()).toISOString(),
  };
  writeQualifiedRecord(repoRoot, qualified);
  const registryUpdated = updateRegistry(repoRoot, failureClass, incident);
  const playbookUpdated = updatePlaybook(repoRoot, failureClass, incident);
  const intakePath = mintIntakeStub(repoRoot, failureClass, qualified);
  markCompleted(repoRoot, key);
  return {
    outcome: 'ok',
    failure_class: failureClass,
    intakePath,
    registryUpdated,
    playbookUpdated,
    qualified,
  };
}

export function formatPostmortemReply(result: PostmortemOutcome): string {
  if (result.outcome === 'refused') {
    return `postmortem: refused — ${result.reason}`;
  }
  return [
    `postmortem: ok failure_class=${result.failure_class}`,
    `playbook updated: ${result.playbookUpdated ? 'yes' : 'no'}`,
    `registry updated: ${result.registryUpdated ? 'yes' : 'no'}`,
    `intake: ${result.intakePath}`,
  ].join('\n');
}
