/**
 * BL-1784 (human directive 2026-09-26, "enforce this rule even harder on
 * the swarm engine"): folds BL-1782's verification-debt ledger into an
 * Article 3.5 throttle signal, the same shape BL-1429's standingRedSignal.ts
 * already established for the standing-red register. The ledger is read
 * through verification_debt_ledger_read.bb (BL-1782 invariant 3: never a
 * second YAML parser here) - this module never reads
 * backlog/verification-debt-ledger.yaml itself.
 *
 * Cap 1 only, never 0 - the same soft stop as the standing-red signal
 * (Article 3.5), folded by emit-throttle-recommendation.ts via the same
 * never-raise min() every other signal already uses.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'verification_debt_ledger_read.bb');

export interface VerificationDebtRecommendation {
  recommendedCap: 1;
  categories: string[];
}

export interface VerificationDebtLedgerReport {
  categories: Record<string, unknown>;
  unowned: string[];
}

// Shared wording for the throttle change log and the episode's human-readable
// opening-signal phrase - one place, so the two never drift into naming the
// same category differently.
export function describeVerificationDebtSignal(categories: string[]): string {
  const noun = categories.length === 1 ? 'category' : 'categories';
  return `the verification-debt ${noun} ${categories.join(', ')}`;
}

function isVerificationDebtLedgerReport(value: unknown): value is VerificationDebtLedgerReport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    !!v.categories &&
    typeof v.categories === 'object' &&
    Array.isArray(v.unowned) &&
    v.unowned.every((c) => typeof c === 'string')
  );
}

/**
 * Pure: the reader's own report -> the throttle recommendation, or null
 * when nothing is unowned. Every category this reports is already at or
 * over its threshold with no open-ticket owner (BL-1782's own job); this
 * fold only asks whether that list is empty.
 */
export function verificationDebtSignal(report: VerificationDebtLedgerReport): VerificationDebtRecommendation | null {
  if (report.unowned.length > 0) {
    return { recommendedCap: 1, categories: [...report.unowned] };
  }
  return null;
}

/**
 * Impure: shells to BL-1782's reader CLI, degrading to null on any failure
 * to actually RUN it - missing bb, a non-zero exit, or unparseable output -
 * the same guarded-shell-out-and-degrade convention standingRedSignal.ts's
 * own readStandingRedReport uses for its sibling bb-backed reader. A broken
 * reader must not freeze intake. A ledger file that is simply absent is not
 * a failure: the CLI itself reports that as a valid, empty report (zero
 * categories, nothing unowned).
 */
export function readVerificationDebtReport(targetRepoPath: string): VerificationDebtLedgerReport | null {
  try {
    const out = execFileSync('bb', [CLI, targetRepoPath], { encoding: 'utf8' });
    const parsed: unknown = JSON.parse(out);
    return isVerificationDebtLedgerReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Composition point: read the report, fold to a recommendation. Null when
 * the CLI fails or is absent (degrade, never throw) or nothing is unowned.
 */
export function computeVerificationDebtRecommendation(targetRepoPath: string): VerificationDebtRecommendation | null {
  const report = readVerificationDebtReport(targetRepoPath);
  if (!report) {
    return null;
  }
  return verificationDebtSignal(report);
}
