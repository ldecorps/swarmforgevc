import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem, BacklogFolders, readBacklogFolders } from '../panel/backlogReader';
import { runGitLog, deriveTicketLifecycles, getCurrentSha, TicketLifecycleEvent } from './gitHistoryAdapter';
import { computeDeliveryMetrics, DeliveryMetrics, VelocityResult, MilestoneBurndownResult, CycleTimeResult, ForecastResult } from './deliveryMetrics';
import { RoleWorktree } from './swarmMetrics';
import { readSwarmName } from '../bridge/holisticProjections';
import { CostHealthSidecar } from '../notify/costHealthSidecar';
import { translateString, TranslationSession } from '../i18n/translate';
import { TARGET_LOCALES } from '../i18n/targetLocales';

// BL-097: backlog.json's data contract - a versioned, git-derived
// projection of backlog state + BL-096 metrics, reusing computeDeliveryMetrics
// as-is (never re-deriving numbers) so a backlog.json generated at a given
// SHA agrees with the metrics CLI run at that same SHA by construction
// (dashboard-02). Generator logic here is pure over already-read data; only
// computeBacklogDashboard touches git/fs.

export const BACKLOG_DASHBOARD_SCHEMA_VERSION = 1;

export interface DashboardTicketSummary {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'done';
  swarm: string;
  milestone?: string;
  priority?: number;
  specDateIso?: string;
  closeDateIso?: string;
  p50Iso?: string;
  p85Iso?: string;
  // BL-230: additive, per-locale - only translateBacklogDashboard
  // populates this; buildBacklogDashboard/computeBacklogDashboard alone
  // never set it. Keyed by locale code (targetLocales.ts's TARGET_LOCALES),
  // generalizing BL-118's single fixed titleFr/titleFrUntranslated fields -
  // adding a target locale means a new key in this same map, not a new
  // pair of fields (add-language-05: no per-language code change).
  titleTranslations?: Record<string, { title: string; untranslated?: boolean }>;
}

export interface NeedsApprovalEntry {
  id: string;
  title: string;
}

export interface BacklogDashboardData {
  schemaVersion: number;
  generatedAtIso: string;
  sourceSha: string | null;
  board: {
    active: DashboardTicketSummary[];
    paused: DashboardTicketSummary[];
    doneByMilestone: Record<string, DashboardTicketSummary[]>;
  };
  // BL-251: live (active + paused) tickets whose human_approval field is
  // "pending" - the SINGLE SOURCE both the PWA and the daily briefing read,
  // derived only from that structured field, never the free-text
  // "# HUMAN APPROVAL:" comment. Always present (possibly empty), never
  // omitted, so both surfaces can render an explicit no-data state from it
  // rather than treating "field absent" as "nothing to show yet."
  needsApproval: NeedsApprovalEntry[];
  // BL-263: the total of live (active + paused) tickets, excluding done -
  // the SINGLE SOURCE both the PWA and the daily briefing read, so neither
  // surface recomputes "not done" a second way and the two can never
  // disagree. Always present (zero when every ticket is done), never
  // omitted - same "explicit rather than absent" convention as needsApproval.
  notDoneCount: number;
  metrics: {
    velocity: VelocityResult;
    burndown: MilestoneBurndownResult[];
    cycleTime: CycleTimeResult;
    forecasts: ForecastResult;
  };
  // BL-213 cost-06a: additive, optional - the latest committed
  // docs/briefings/<date>.json sidecar, folded in as-is. Absent when no
  // sidecar has ever been committed; schemaVersion stays unchanged either
  // way since this is a purely additive field.
  costHealth?: CostHealthSidecar;
}

const UNSPECIFIED_MILESTONE = 'unspecified';

// The three field groups below are set only when present so the JSON
// payload never carries an explicit `undefined`. Split out of
// toDashboardSummary so each function stays under the CRAP<=6 gate.
function applyItemFields(summary: DashboardTicketSummary, item: BacklogItem): void {
  if (item.milestone !== undefined) {
    summary.milestone = item.milestone;
  }
  if (item.priority !== undefined) {
    summary.priority = item.priority;
  }
}

function applyLifecycleFields(summary: DashboardTicketSummary, lifecycle: TicketLifecycleEvent | undefined): void {
  if (lifecycle?.specDateIso) {
    summary.specDateIso = lifecycle.specDateIso;
  }
  if (lifecycle?.closeDateIso) {
    summary.closeDateIso = lifecycle.closeDateIso;
  }
}

function applyForecastFields(
  summary: DashboardTicketSummary,
  ticketId: string,
  p50ByTicketId: Map<string, string>,
  p85ByTicketId: Map<string, string>
): void {
  const p50 = p50ByTicketId.get(ticketId);
  if (p50) {
    summary.p50Iso = p50;
  }
  const p85 = p85ByTicketId.get(ticketId);
  if (p85) {
    summary.p85Iso = p85;
  }
}

function toDashboardSummary(
  item: BacklogItem,
  status: DashboardTicketSummary['status'],
  localSwarmName: string,
  lifecycleByTicketId: Map<string, TicketLifecycleEvent>,
  p50ByTicketId: Map<string, string>,
  p85ByTicketId: Map<string, string>
): DashboardTicketSummary {
  const summary: DashboardTicketSummary = {
    id: item.id,
    title: item.title,
    status,
    swarm: item.swarm ?? localSwarmName,
  };
  applyItemFields(summary, item);
  applyLifecycleFields(summary, lifecycleByTicketId.get(item.id));
  applyForecastFields(summary, item.id, p50ByTicketId, p85ByTicketId);
  return summary;
}

// BL-251: live-only (active + paused, never done/) - matches the ticket's
// own "not applicable" reading of absent/approved, and the constraint that
// the needs-approval list is exactly the LIVE items still pending review.
function computeNeedsApproval(active: BacklogItem[], paused: BacklogItem[]): NeedsApprovalEntry[] {
  return [...active, ...paused]
    .filter((item) => item.humanApproval === 'pending')
    .map((item) => ({ id: item.id, title: item.title }));
}

// BL-263 count-excludes-done-01: "not done" = every live ticket - active and
// paused - excluding done. A pure derivation over the same folders already
// read for the board above, never a second backlog scan.
export function computeNotDoneCount(active: BacklogItem[], paused: BacklogItem[]): number {
  return active.length + paused.length;
}

function groupDoneByMilestone(
  doneItems: BacklogItem[],
  localSwarmName: string,
  lifecycleByTicketId: Map<string, TicketLifecycleEvent>,
  p50ByTicketId: Map<string, string>,
  p85ByTicketId: Map<string, string>
): Record<string, DashboardTicketSummary[]> {
  const result: Record<string, DashboardTicketSummary[]> = {};
  for (const item of doneItems) {
    const milestone = item.milestone ?? UNSPECIFIED_MILESTONE;
    if (!result[milestone]) {
      result[milestone] = [];
    }
    result[milestone].push(toDashboardSummary(item, 'done', localSwarmName, lifecycleByTicketId, p50ByTicketId, p85ByTicketId));
  }
  return result;
}

// Pure: assembles the full backlog.json payload from already-read backlog
// folders, git-derived lifecycles, and BL-096's delivery metrics (passed
// through unmodified - never re-derived here). Test-suite duration is
// deliberately excluded: its records are gitignored/machine-local, so no
// git-derived projection can see them.
export function buildBacklogDashboard(
  folders: BacklogFolders,
  lifecycles: TicketLifecycleEvent[],
  deliveryMetrics: DeliveryMetrics,
  localSwarmName: string,
  sourceSha: string | null,
  generatedAtIso: string,
  costHealth: CostHealthSidecar | null = null
): BacklogDashboardData {
  const lifecycleByTicketId = new Map(lifecycles.map((l) => [l.ticketId, l]));
  const p50ByTicketId = new Map(
    deliveryMetrics.forecasts.tickets.filter((t) => t.p50Iso !== null).map((t) => [t.ticketId, t.p50Iso as string])
  );
  const p85ByTicketId = new Map(
    deliveryMetrics.forecasts.tickets.filter((t) => t.p85Iso !== null).map((t) => [t.ticketId, t.p85Iso as string])
  );

  const toSummary = (item: BacklogItem, status: DashboardTicketSummary['status']) =>
    toDashboardSummary(item, status, localSwarmName, lifecycleByTicketId, p50ByTicketId, p85ByTicketId);

  const dashboard: BacklogDashboardData = {
    schemaVersion: BACKLOG_DASHBOARD_SCHEMA_VERSION,
    generatedAtIso,
    sourceSha,
    board: {
      active: folders.active.map((item) => toSummary(item, 'active')),
      paused: folders.paused.map((item) => toSummary(item, 'paused')),
      doneByMilestone: groupDoneByMilestone(folders.done, localSwarmName, lifecycleByTicketId, p50ByTicketId, p85ByTicketId),
    },
    needsApproval: computeNeedsApproval(folders.active, folders.paused),
    notDoneCount: computeNotDoneCount(folders.active, folders.paused),
    metrics: {
      velocity: deliveryMetrics.velocity,
      burndown: deliveryMetrics.burndown,
      cycleTime: deliveryMetrics.cycleTime,
      forecasts: deliveryMetrics.forecasts,
    },
  };
  if (costHealth) {
    dashboard.costHealth = costHealth;
  }
  return dashboard;
}

const SIDECAR_FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

// BL-213 cost-06a: the most recently committed docs/briefings/<date>.json
// sidecar (ISO date filenames sort chronologically). No sidecar ever
// committed, or a malformed/unreadable one, reads as null rather than
// throwing - cost-06b's "hidden when absent" is handled entirely by
// buildBacklogDashboard's own costHealth-omitted-when-null branch above.
function readLatestCostHealthSidecar(targetPath: string): CostHealthSidecar | null {
  const briefingsDir = path.join(targetPath, 'docs', 'briefings');
  let files: string[];
  try {
    files = fs.readdirSync(briefingsDir).filter((f) => SIDECAR_FILENAME_PATTERN.test(f));
  } catch {
    return null;
  }
  if (files.length === 0) {
    return null;
  }
  files.sort();
  try {
    return JSON.parse(fs.readFileSync(path.join(briefingsDir, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

// The one impure entry point: reads current backlog state, walks git
// history, computes delivery metrics (reusing computeDeliveryMetrics
// as-is), resolves the source SHA, and reads the latest committed cost/
// health sidecar if one exists - then delegates to the pure assembler above.
export function computeBacklogDashboard(targetPath: string, roles: RoleWorktree[], nowMs: number = Date.now()): BacklogDashboardData {
  const folders = readBacklogFolders(targetPath);
  const lifecycles = [...deriveTicketLifecycles(runGitLog(targetPath, 'backlog')).values()];
  const deliveryMetrics = computeDeliveryMetrics(targetPath, roles, nowMs);
  const localSwarmName = readSwarmName(targetPath);
  const sourceSha = getCurrentSha(targetPath);
  const costHealth = readLatestCostHealthSidecar(targetPath);

  return buildBacklogDashboard(folders, lifecycles, deliveryMetrics, localSwarmName, sourceSha, new Date(nowMs).toISOString(), costHealth);
}

// BL-230: translates summary.title into every configured target locale
// (TARGET_LOCALES) - the N-language generalization of BL-118's
// single-fr translateSummary. Adding a target locale is purely a
// TARGET_LOCALES config change; this loop never changes.
async function translateSummary(session: TranslationSession, summary: DashboardTicketSummary): Promise<DashboardTicketSummary> {
  const titleTranslations: Record<string, { title: string; untranslated?: boolean }> = {};
  for (const locale of TARGET_LOCALES) {
    const translated = await translateString(session, summary.title, locale);
    titleTranslations[locale] = translated.untranslated ? { title: translated.text, untranslated: true } : { title: translated.text };
  }
  return { ...summary, titleTranslations };
}

// BL-118/BL-230: populates every board ticket's additive titleTranslations,
// mirroring docsTree.ts's translateDocsTree - a separate pass over an
// already-computed English dashboard, so translation can be skipped
// entirely without touching computeBacklogDashboard's own derivation.
export async function translateBacklogDashboard(data: BacklogDashboardData, session: TranslationSession): Promise<BacklogDashboardData> {
  const active = await Promise.all(data.board.active.map((s) => translateSummary(session, s)));
  const paused = await Promise.all(data.board.paused.map((s) => translateSummary(session, s)));
  const doneByMilestone: Record<string, DashboardTicketSummary[]> = {};
  for (const [milestone, summaries] of Object.entries(data.board.doneByMilestone)) {
    doneByMilestone[milestone] = await Promise.all(summaries.map((s) => translateSummary(session, s)));
  }
  return { ...data, board: { active, paused, doneByMilestone } };
}
