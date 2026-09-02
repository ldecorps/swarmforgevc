import * as fs from 'fs';
import * as path from 'path';
import { readHandoffHeaderRecordsWithBatches, extractTicketId } from '../metrics/swarmMetrics';

const SWARMFORGE_DIR = '.swarmforge';
const HANDOFF_EXTENSION = '.handoff';
const INBOX_SUBDIRS = ['new', 'in_process'];
const TSV_ROLE_INDEX = 0;
const TSV_WORKTREE_NAME_INDEX = 1;
const TSV_WORKTREE_INDEX = 2;
const TSV_DISPLAY_NAME_INDEX = 4;
const TSV_AGENT_INDEX = 5;

export interface RoleEntry {
  role: string;
  worktreeName: string;
  worktreePath: string;
  displayName: string;
  // BL-208: the configured agent/provider brand (claude/aider/grok/codex/
  // copilot/mock - agent_runtime_lib.bb's supported-agents), the one
  // common field cross-provider readers group telemetry by. Undefined for
  // a TSV row shorter than expected, never a crash.
  agent?: string;
}

export interface PipelineStage {
  role: string;
  displayName: string;
  status: 'active' | 'idle';
  // BL-452: the pipeline board's own data source - ticket id(s) this role is
  // CURRENTLY holding, right now, in in_process (never inbox/new, which is
  // merely queued; never completed history) - a cheap, one-directory read,
  // no git walk. A batch role (cleaner/hardener) may hold several at once.
  // Distinct from telegram-front-desk-bot.ts's own readRoleTicket (BL-301),
  // which derives "current holder" from completed+in_process holding
  // WINDOWS - the hop-log-shaped mechanism the Operator explicitly rejected
  // as this feature's data source (BL-452 ticket notes).
  heldTicketIds: string[];
}

// Split out of parseRolesTsv so each function stays under the CRAP<=6 gate
// - the agent field is only present on the entry when the TSV row actually
// carried one (an `agent?: undefined` property would fail the ticket's own
// "omitted, not present-but-undefined" role-entry shape elsewhere).
function buildRoleEntry(role: string, worktreeName: string, worktreePath: string, displayName: string, agent: string): RoleEntry {
  return agent ? { role, worktreeName, worktreePath, displayName, agent } : { role, worktreeName, worktreePath, displayName };
}

export function parseRolesTsv(tsv: string): RoleEntry[] {
  const entries: RoleEntry[] = [];
  for (const line of tsv.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const role = parts[TSV_ROLE_INDEX];
    const worktreeName = parts[TSV_WORKTREE_NAME_INDEX];
    const worktreePath = parts[TSV_WORKTREE_INDEX];
    const displayName = parts[TSV_DISPLAY_NAME_INDEX];
    if (role && worktreePath && displayName) {
      entries.push(buildRoleEntry(role, worktreeName, worktreePath, displayName, parts[TSV_AGENT_INDEX]));
    }
  }
  return entries;
}

// BL-128: the one shared, role-keyed mailbox path resolver on the
// TypeScript side, mirroring handoff_lib.bb's mailbox-base-dir/mailbox-dir.
// Coordinator and specifier both run on the shared `master` worktree, so
// they get their own <role> subdirectory; every other role's own dedicated
// worktree already provides physical separation and keeps the flat layout.
export function mailboxBaseDir(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): string {
  if (entry.worktreeName === 'master') {
    return path.join(entry.worktreePath, SWARMFORGE_DIR, 'handoffs', entry.role);
  }
  return path.join(entry.worktreePath, SWARMFORGE_DIR, 'handoffs');
}

export function mailboxDir(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>, ...segments: string[]): string {
  return path.join(mailboxBaseDir(entry), ...segments);
}

export function readHandoffInboxStatus(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): 'active' | 'idle' {
  for (const subdir of INBOX_SUBDIRS) {
    const dir = mailboxDir(entry, 'inbox', subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    if (hasHandoffFiles(dir)) {
      return 'active';
    }
  }

  return 'idle';
}

function hasHandoffFiles(dir: string): boolean {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(HANDOFF_EXTENSION)) {
        return true;
      }
      const fullPath = path.join(dir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        if (fs.readdirSync(fullPath).some((f) => f.endsWith(HANDOFF_EXTENSION))) {
          return true;
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return false;
}

// BL-452: every distinct ticket id this role's in_process handoff(s) name -
// reuses the SAME batch-aware handoff-header reader ticketHoldingWindows.ts
// already relies on (readHandoffHeaderRecordsWithBatches) and the shared
// ticket-id extraction (extractTicketId), rather than re-deriving either.
// Deduped since a role should not report the same held ticket twice even if
// an anomaly left more than one handoff naming it.
function readInProcessTicketIds(entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>): string[] {
  const dir = mailboxDir(entry, 'inbox', 'in_process');
  const ids = readHandoffHeaderRecordsWithBatches(dir)
    .map((headers) => {
      const fromTask = headers.task ? extractTicketId(headers.task) : null;
      if (fromTask) {
        return fromTask;
      }
      return headers.message ? extractTicketId(headers.message) : null;
    })
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

export function readPipelineStages(targetPath: string): PipelineStage[] {
  const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return [];
  }

  const tsv = fs.readFileSync(rolesFile, 'utf8');
  return parseRolesTsv(tsv).map((entry) => ({
    role: entry.role,
    displayName: entry.displayName,
    status: readHandoffInboxStatus(entry),
    heldTicketIds: readInProcessTicketIds(entry),
  }));
}

// BL-464: the pipeline board's AUTHORITATIVE ticket->stage source, replacing
// readInProcessTicketIds/readPipelineStages's own heldTicketIds as the
// board's data source (readPipelineStages itself stays unchanged - the VS
// Code panel's own currentStageLabel/findLiveHolder still use it). This is a
// bot-owned, machine-local file (gitignored under .swarmforge/, same
// posture as every other file in that directory) written EXCLUSIVELY by the
// coordinator's own `bb swarmforge/scripts/pipeline_stage_cli.bb
// <project-root> sync` (swarmforge/roles/coordinator.prompt) - a real
// production writer, never a fixture-only/dark store. Tolerant of a
// missing/corrupt file (no sync has ever run yet, or a torn write mid-
// rewrite) - an empty map degrades to "no active ticket known", never a
// crash or a fabricated location.
/**
 * BL-670: the stage QUALIFIER, mirrored from pipeline_stage_lib.bb.
 *
 * These three literals cross a language boundary - the bb side writes them
 * into ticket-stage-map.json and this side reads them - so per the engineering
 * article's mirrored-constant rule (BL-897) a TEST asserts the two spellings
 * agree, rather than a comment asking the next editor to remember.
 */
export const TICKET_STAGE_STATUS_CLAIMED = 'claimed';
export const TICKET_STAGE_STATUS_IN_TRANSIT = 'in-transit-to';
export const TICKET_STAGE_STATUS_LAST_KNOWN = 'last-known';

export type TicketStageStatus =
  | typeof TICKET_STAGE_STATUS_CLAIMED
  | typeof TICKET_STAGE_STATUS_IN_TRANSIT
  | typeof TICKET_STAGE_STATUS_LAST_KNOWN;

/** BL-670: the per-ticket health dot, also mirrored from the bb side. */
export const TICKET_HEALTH_DOT_GREEN = 'green';
export const TICKET_HEALTH_DOT_YELLOW = 'yellow';
export const TICKET_HEALTH_DOT_RED = 'red';

export type TicketHealthDot =
  | typeof TICKET_HEALTH_DOT_GREEN
  | typeof TICKET_HEALTH_DOT_YELLOW
  | typeof TICKET_HEALTH_DOT_RED;

export interface TicketStageEntry {
  stage: string;
  status: TicketStageStatus;
  /** ISO instant the observation this entry came from was recorded. */
  asOf?: string;
  healthDot?: TicketHealthDot;
}

/**
 * BL-670: a bare role string is still accepted, and that is deliberate rather
 * than leftover. The map on disk is written by whichever `pipeline_stage_cli.bb`
 * the target checkout has, and several acceptance fixtures write the pre-BL-670
 * `{ticket: role}` shape directly; normalising here means one reader serves
 * both, and a swarm mid-upgrade never renders a blank board because its cache
 * predates the qualifier. An entry with no status is reported as `last-known`,
 * which is the honest reading of "we know where it was and nothing more".
 */
// BL-1040: seat identity never escapes the mailbox layer on the OBSERVATION
// path either. BL-983 declared that invariant and enforced it only where a
// seat FORWARDS work; a seat key (`coder@sonnet2`) still survived into the
// stage map, through the held-role grouping, and reached a renderer that
// knows only bare stage names - matching nothing and painting the ticket as
// not-started while the seat was actively working it.
//
// This is the READER chokepoint, and folding here is what closes the stale
// -file case: the stage map is a file on disk that outlives the process
// which wrote it, so a map recorded by a pre-fix producer must still read
// correctly. Normalising at the source (pipeline_stage_cli.bb) and folding
// here are not alternatives - they cover different populations of map.
export function stageOfSeat(roleOrSeat: string): string {
  const at = roleOrSeat.indexOf('@');
  return at === -1 ? roleOrSeat : roleOrSeat.slice(0, at);
}

function normaliseBareRoleStage(value: string): TicketStageEntry | undefined {
  return value ? { stage: stageOfSeat(value), status: TICKET_STAGE_STATUS_LAST_KNOWN } : undefined;
}

function normaliseObjectStage(value: object): TicketStageEntry | undefined {
  const entry = value as Partial<TicketStageEntry>;
  if (typeof entry.stage !== 'string' || !entry.stage) {
    return undefined;
  }
  return {
    stage: stageOfSeat(entry.stage),
    status: (entry.status as TicketStageStatus) ?? TICKET_STAGE_STATUS_LAST_KNOWN,
    asOf: entry.asOf,
    healthDot: entry.healthDot,
  };
}

export function normaliseTicketStageEntry(value: unknown): TicketStageEntry | undefined {
  if (typeof value === 'string') {
    return normaliseBareRoleStage(value);
  }
  if (value && typeof value === 'object') {
    return normaliseObjectStage(value);
  }
  return undefined;
}

export function readTicketStageMap(targetPath: string): Record<string, TicketStageEntry> {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(targetPath, SWARMFORGE_DIR, 'board', 'ticket-stage-map.json'), 'utf8')
    ) as Record<string, unknown>;
    const out: Record<string, TicketStageEntry> = {};
    for (const [ticketId, value] of Object.entries(raw)) {
      const entry = normaliseTicketStageEntry(value);
      if (entry) {
        out[ticketId] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Pure: inverts the authoritative {ticketId: role} map into the
// {role: ticketId[]} shape computePipelineBoard already expects
// (pipelineBoard.ts) - trivially one role per ticket id by construction
// (a plain object key can only ever hold one value), which is what
// structurally closes the double-row defect at its source; computePipeline
// Board's own dedup (BL-464) is the belt-and-braces guarantee for whatever
// reaches it regardless of the source.
export function invertTicketStageToRoleHeldTickets(
  stageMap: Record<string, TicketStageEntry | string>
): Record<string, string[]> {
  const byRole: Record<string, string[]> = {};
  for (const [ticketId, value] of Object.entries(stageMap)) {
    // BL-670: takes either shape, for the same reason readTicketStageMap does
    // - a caller holding a pre-qualifier map must not silently invert to an
    // empty board.
    const entry = normaliseTicketStageEntry(value);
    if (entry) {
      (byRole[entry.stage] ??= []).push(ticketId);
    }
  }
  return byRole;
}

export function currentStageLabel(stages: PipelineStage[]): string {
  const active = stages.filter((s) => s.status === 'active');
  if (active.length === 0) {
    return 'idle';
  }
  return active.map((s) => s.displayName).join(', ');
}

function parseHandoffTask(content: string): string | null {
  const match = content.match(/^task:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function readHandoffFilesFromInbox(inboxPath: string): Array<{ task: string | null }> {
  const handoffs: Array<{ task: string | null }> = [];

  for (const subdir of INBOX_SUBDIRS) {
    const dir = path.join(inboxPath, subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }

    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith(HANDOFF_EXTENSION)) {
          const filePath = path.join(dir, entry);
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const task = parseHandoffTask(content);
            handoffs.push({ task });
          } catch {
            // ignore unreadable handoff files
          }
        } else {
          // Check batch directories
          const fullPath = path.join(dir, entry);
          if (fs.statSync(fullPath).isDirectory()) {
            try {
              for (const batchFile of fs.readdirSync(fullPath)) {
                if (batchFile.endsWith(HANDOFF_EXTENSION)) {
                  const filePath = path.join(fullPath, batchFile);
                  try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const task = parseHandoffTask(content);
                    handoffs.push({ task });
                  } catch {
                    // ignore unreadable handoff files
                  }
                }
              }
            } catch {
              // ignore unreadable batch directories
            }
          }
        }
      }
    } catch {
      // ignore unreadable inbox directories
    }
  }

  return handoffs;
}

export function findLiveHolder(targetPath: string, itemId: string): string | null {
  const stages = readPipelineStages(targetPath);
  const rolesFile = path.join(targetPath, SWARMFORGE_DIR, 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return null;
  }

  const tsv = fs.readFileSync(rolesFile, 'utf8');
  const roles = parseRolesTsv(tsv);

  // For each active stage, check if it has a handoff with the matching task
  for (const stage of stages) {
    if (stage.status !== 'active') {
      continue;
    }

    const role = roles.find((r) => r.role === stage.role);
    if (!role) {
      continue;
    }

    const inboxPath = path.join(role.worktreePath, SWARMFORGE_DIR, 'handoffs', 'inbox');
    const handoffs = readHandoffFilesFromInbox(inboxPath);

    for (const handoff of handoffs) {
      if (handoff.task && handoff.task.toLowerCase().startsWith(itemId.toLowerCase())) {
        return stage.role;
      }
    }
  }

  return null;
}
