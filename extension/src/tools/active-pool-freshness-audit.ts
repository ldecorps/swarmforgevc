#!/usr/bin/env node
/**
 * BL-1228: reports every ticket in backlog/active/ whose deprecator
 * freshness check (Article 3.6) does not positively return "allow". Never
 * moves, creates, deletes, or rewrites a backlog file - report only.
 * Article 3.6 gives adjudication to the specifier; this is the mechanical
 * backstop for a hand-rolled promotion that walks past that gate unnoticed
 * (main commit cac8afef8, 2026-08-28).
 *
 * Fails closed: a missing CLI, non-zero exit, unparseable output, or
 * unrecognised decision is reported as a hold, never silently treated as
 * clear. The real VERDICT always comes from deprecate-check.js's own
 * evaluateDeprecatorFreshness, reached only through the real CLI subprocess
 * below - this module never re-decides it. Its JSON-shape interpretation is
 * a small file-independent duplicate (see interpretFreshness below for why).
 *
 * Usage: node active-pool-freshness-audit.js <project-root>
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { makeArgsGuardedMain, runCliMain } from './swarm-metrics';
import type { FreshnessDecision } from './deprecate-check';

// BL-1228 qa_e2e_procedure step 3 requires this module to keep working (fail
// closed, never crash) when extension/out/tools/deprecate-check.js is
// renamed/removed - the exact file the CLI subprocess below shells out to.
// Statically `require`-ing deprecate-check.js's own interpreter for that
// would defeat the test: Node resolves that require at THIS module's load
// time, so removing the file would crash the audit before main() ever runs,
// not degrade gracefully. interpretFreshness below is therefore a small,
// self-contained, file-independent duplicate of
// deprecate-check.ts/interpretFreshnessCliOutput's fail-closed JSON-shape
// parsing (never a second implementation of the VERDICT itself - that stays
// solely in deprecate-check.ts's evaluateDeprecatorFreshness, reached only
// through the real CLI subprocess). Parity with the original is asserted by
// activePoolFreshnessAudit.test.js's cross-check test (BL-897 discipline: a
// duplicated-by-hand behavior needs a test proving both sides agree).
const MALFORMED_VERDICT: FreshnessDecision = { decision: 'hold', reason: 'malformed deprecate-check output — fail closed' };

function isBlankRaw(raw: string | null | undefined): boolean {
  return raw === null || raw === undefined || String(raw).trim() === '';
}

function resolveHoldReason(reason: unknown): string {
  return typeof reason === 'string' && reason.length > 0 ? reason : 'hold without reason — fail closed';
}

/** The decision-object branch alone, split out to keep interpretFreshness's own complexity low (CRAP gate). Null means "not a recognised shape" — caller falls back to MALFORMED_VERDICT. */
function interpretParsedVerdict(parsed: unknown): FreshnessDecision | null {
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const obj = parsed as { decision?: unknown; reason?: unknown };
  if (obj.decision === 'allow') {
    return { decision: 'allow' };
  }
  if (obj.decision === 'hold') {
    return { decision: 'hold', reason: resolveHoldReason(obj.reason) };
  }
  return null;
}

function interpretFreshness(raw: string | null | undefined): FreshnessDecision {
  if (isBlankRaw(raw)) {
    return { decision: 'hold', reason: 'empty deprecate-check output — fail closed' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return MALFORMED_VERDICT;
  }
  // `??` vs `||` here is an equivalent mutant, recorded rather than chased:
  // interpretParsedVerdict returns only `null` or a FreshnessDecision object
  // (never `0`, `''`, `false`, or `NaN`), so nullish-coalescing and logical-OR
  // agree on every possible return value.
  return interpretParsedVerdict(parsed) ?? MALFORMED_VERDICT;
}

export interface ActiveTicketRef {
  id: string;
  path: string;
}

export interface ActivePoolAuditFinding {
  ticketId: string;
  path: string;
  reason: string;
}

/** Every backlog/active/*.yaml, id read from its own `id:` field (never the filename slug). */
export function listActiveTicketRefs(root: string): ActiveTicketRef[] {
  const dir = path.join(root, 'backlog', 'active');
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => {
      const full = path.join(dir, name);
      const text = fs.readFileSync(full, 'utf8');
      const m = text.match(/^id:\s*"?([^"\s]+)"?\s*$/m);
      const id = m ? m[1] : name.replace(/\.yaml$/, '');
      return { id, path: path.relative(root, full) };
    });
}

export type CheckFreshnessFn = (root: string, ticketId: string) => string;

/**
 * Pure over an injected verdict lookup (constraint: no real backlog corpus
 * in unit tests). Invariant 1: reported unless the interpreted decision is
 * exactly "allow" - a missing/crashing/unparseable/unrecognised verdict
 * (interpretFreshness's own fail-closed hold) is reported too.
 */
export function auditActivePool(
  root: string,
  refs: ActiveTicketRef[],
  checkFreshness: CheckFreshnessFn
): ActivePoolAuditFinding[] {
  const findings: ActivePoolAuditFinding[] = [];
  for (const ref of refs) {
    const raw = checkFreshness(root, ref.id);
    const decision = interpretFreshness(raw);
    if (decision.decision !== 'allow') {
      findings.push({ ticketId: ref.id, path: ref.path, reason: decision.reason });
    }
  }
  return findings;
}

/**
 * The REAL CLI, as a subprocess - same shape as promote_and_route_next.sh's
 * own deprecate_check_cli, so a renamed/missing deprecate-check.js fails
 * this exactly the same way it fails that gate (fail-closed, never a crash).
 */
export function resolveDeprecateCheckCliPath(root: string): string | undefined {
  const candidate = path.join(root, 'extension', 'out', 'tools', 'deprecate-check.js');
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function checkFreshnessViaCli(root: string, ticketId: string): string {
  const cli = resolveDeprecateCheckCliPath(root);
  if (!cli) {
    return '';
  }
  const result = spawnSync('node', [cli, root, ticketId], { encoding: 'utf8' });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout;
}

export function formatFinding(f: ActivePoolAuditFinding): string {
  return `ACTIVE-POOL-FRESHNESS-HOLD ${f.ticketId}  ${f.path}  (${f.reason})`;
}

export function parseArgs(argv: string[]): { root: string } | null {
  const [root] = argv;
  if (!root) {
    return null;
  }
  return { root };
}

/** Pure: the lines main() prints for a run's findings — split out so the CLI handler stays a thin loop (CLI main() thin-wrapper rule). */
export function formatReport(findings: ActivePoolAuditFinding[]): string[] {
  if (findings.length === 0) {
    return ['active_pool_freshness_audit: clean — every backlog/active/ ticket allows'];
  }
  return findings.map(formatFinding);
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node active-pool-freshness-audit.js <project-root>\n',
  async ({ root }) => {
    const refs = listActiveTicketRefs(root);
    const findings = auditActivePool(root, refs, checkFreshnessViaCli);
    for (const line of formatReport(findings)) {
      console.log(line);
    }
  }
);

if (require.main === module) {
  runCliMain(main);
}
