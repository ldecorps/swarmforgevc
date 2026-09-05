/**
 * BL-1365: the ritual ledger — the computed half of "the ceremony packet names
 * hand-made rituals".
 *
 * The detector, in one sentence: a ritual performed by a SCRIPT collapses to
 * one commit subject, a ritual performed by an AGENT has a long tail of them.
 * Measured on real history before this module existed: promotion's 484 commits
 * share one generated subject (dominance ~1.00) and the topic store's 2290
 * share another (0.97), while pass/bounce evidence's most repeated subject
 * appears 29 times across 2182 commits (0.01). Nothing separates those three
 * as cleanly, and it needs no new instrumentation — `git log --name-only` is
 * the whole input.
 *
 * This module is PURE: it folds commits into per-class statistics and picks
 * candidates. It never reads git, never reads the ceremony, and never mints
 * anything (invariant 3 — the ledger proposes, the specifier disposes).
 * Invariant 1's "computed outside the ceremony" is the producer's job
 * (ritualLedgerProducer.ts); the ceremony only ever READS what it stored.
 */
import type { CeremonyDeterminismCandidate } from '../quality/closingCeremony';

/**
 * The two thresholds, deliberately at the top of the file and exported rather
 * than buried in a predicate: the ticket says they will need tuning and that
 * tuning should be cheap. Both are compared against the measured spread above,
 * which leaves a wide margin on either side — the scripted classes sit at 0.97
 * and 1.00, the hand-made one at 0.01, so nothing real is near 0.5.
 */
export const RITUAL_VOLUME_FLOOR = 50;
export const RITUAL_DOMINANCE_CEILING = 0.5;

export interface RitualClass {
  id: string;
  /** The one path prefix that identifies this ritual's commits. */
  pathPrefix: string;
  /** Human-readable, for the packet the specifier actually reads. */
  label: string;
}

/**
 * Ritual classes are PATH AREAS, because that is what a ritual writes. One
 * prefix each: a class needing two prefixes is two rituals that happen to
 * share a directory, and splitting them keeps the dominance figure meaningful.
 */
export const RITUAL_CLASSES: RitualClass[] = [
  { id: 'backlog-promotion', pathPrefix: 'backlog/active/', label: 'backlog promotion' },
  { id: 'backlog-closure', pathPrefix: 'backlog/done/', label: 'backlog closure' },
  { id: 'pass-bounce-evidence', pathPrefix: 'backlog/evidence/', label: 'pass/bounce evidence' },
  { id: 'topic-records', pathPrefix: 'backlog/topics/', label: 'topic records' },
  { id: 'feature-specs', pathPrefix: 'specs/features/', label: 'feature specs' },
  { id: 'step-handlers', pathPrefix: 'specs/pipeline/steps/', label: 'acceptance step handlers' },
  { id: 'extension-source', pathPrefix: 'extension/src/', label: 'extension source' },
  { id: 'extension-tests', pathPrefix: 'extension/test/', label: 'extension tests' },
  { id: 'swarm-scripts', pathPrefix: 'swarmforge/scripts/', label: 'swarm scripts' },
  { id: 'documentation', pathPrefix: 'docs/', label: 'documentation' },
];

export interface RitualCommit {
  subject: string;
  paths: string[];
}

export interface RitualClassStats {
  ritualClass: string;
  label: string;
  commits: number;
  /** A representative ORIGINAL subject for the most common normalized form. */
  topSubject: string;
  topSubjectCount: number;
  /** topSubjectCount / commits — the whole detector, in one number. */
  dominance: number;
  distinctSubjects: number;
}

/**
 * Collapse the parts a generator varies, so one scripted ritual reads as one
 * subject. Order matters: ticket ids, dates and hashes are all digit-bearing,
 * so each must be replaced before the bare-number rule reaches it.
 *
 * The hash rule requires at least one digit (`(?=[0-9a-f]*\d)`) so an ordinary
 * a-f word — "deadbeef" is a hash, "feedable" is not — cannot be mistaken for
 * one.
 */
export function normalizeCommitSubject(subject: string): string {
  return subject
    .replace(/\bBL-\d+\b/gi, '<id>')
    .replace(/\bGH-\d+\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '<n>')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every class the commit's paths touch, each named once, in declared order. */
export function ritualClassesForPaths(paths: string[]): string[] {
  return RITUAL_CLASSES.filter((cls) => paths.some((p) => p.startsWith(cls.pathPrefix))).map((cls) => cls.id);
}

/**
 * A class is "named by" a ticket when the ticket text carries its path prefix
 * or its id. Both are literals nothing writes by accident; the LABEL is
 * deliberately not matched, because "evidence" or "documentation" appear in
 * ordinary prose and would suppress a real candidate on a coincidence
 * (invariant 2 must silence the packet, not blind it).
 */
export function ritualClassIsNamedByText(cls: RitualClass, text: string): boolean {
  const haystack = text.toLowerCase();
  return haystack.includes(cls.pathPrefix.toLowerCase()) || haystack.includes(cls.id.toLowerCase());
}

function statsForClass(cls: RitualClass, subjects: string[]): RitualClassStats {
  const counts = new Map<string, { count: number; representative: string }>();
  for (const subject of subjects) {
    const key = normalizeCommitSubject(subject);
    const seen = counts.get(key);
    if (seen) {
      seen.count += 1;
    } else {
      counts.set(key, { count: 1, representative: subject });
    }
  }
  let top = { count: 0, representative: '' };
  for (const entry of counts.values()) {
    if (entry.count > top.count) {
      top = entry;
    }
  }
  return {
    ritualClass: cls.id,
    label: cls.label,
    commits: subjects.length,
    topSubject: top.representative,
    topSubjectCount: top.count,
    dominance: top.count / subjects.length,
    distinctSubjects: counts.size,
  };
}

/**
 * Fold commits into per-class statistics. A commit touching several areas
 * counts once under EACH — it genuinely participated in each of those rituals,
 * and attributing it to only one would understate whichever lost the toss.
 *
 * A class no commit touched is ABSENT rather than reported as zero, the same
 * silence-is-not-a-measured-zero posture as BL-1364's stage series.
 */
export function buildRitualLedger(commits: RitualCommit[]): RitualClassStats[] {
  const byClass = new Map<string, string[]>();
  for (const commit of commits) {
    for (const id of ritualClassesForPaths(commit.paths)) {
      const bucket = byClass.get(id);
      if (bucket) {
        bucket.push(commit.subject);
      } else {
        byClass.set(id, [commit.subject]);
      }
    }
  }
  return RITUAL_CLASSES.filter((cls) => byClass.has(cls.id))
    .map((cls) => statsForClass(cls, byClass.get(cls.id) as string[]))
    .sort((a, b) => b.commits - a.commits);
}

/**
 * The candidates the packet offers: high enough volume to be worth scripting,
 * low enough dominance to look hand-made, and not already named by an open
 * ticket. Ranked by volume, so the specifier reads the biggest first.
 */
export function determinismCandidatesFromLedger(
  ledger: RitualClassStats[],
  openTicketTexts: string[]
): CeremonyDeterminismCandidate[] {
  const suppressed = new Set(
    RITUAL_CLASSES.filter((cls) => openTicketTexts.some((text) => ritualClassIsNamedByText(cls, text))).map(
      (cls) => cls.id
    )
  );
  return ledger
    .filter(
      (row) =>
        row.commits >= RITUAL_VOLUME_FLOOR &&
        row.dominance < RITUAL_DOMINANCE_CEILING &&
        !suppressed.has(row.ritualClass)
    )
    .sort((a, b) => b.commits - a.commits)
    .map((row) => ({
      ritualClass: row.ritualClass,
      label: row.label,
      commits: row.commits,
      distinctSubjects: row.distinctSubjects,
      dominance: row.dominance,
      topSubject: row.topSubject,
      topSubjectCount: row.topSubjectCount,
    }));
}
