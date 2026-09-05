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
 * Ritual classes are the BOOKKEEPING path areas — the places where a repeated,
 * mechanical act leaves its trace. One prefix each: a class needing two
 * prefixes is two rituals that happen to share a directory, and splitting them
 * keeps the dominance figure meaningful.
 *
 * What is deliberately NOT here, and why. The first version of this list also
 * carried the creative areas — `extension/src/`, `extension/test/`,
 * `specs/features/`, `specs/pipeline/steps/`, `swarmforge/scripts/`, `docs/`.
 * Measured against the live repo (13786 commits over 45 days) every one of
 * them cleared both thresholds, because writing source or a feature spec is
 * of course hand-made, and the packet offered NINE candidates. That is the
 * alert nobody reads, which is the failure mode the ticket names first.
 *
 * The distinction that matters is not "hand-made" but "hand-made AND
 * scriptable". A ritual is a repeated act with a fixed shape a script could
 * perform; writing extension source is not one however varied its subjects
 * are. So the list is the bookkeeping areas only — which is also exactly what
 * the ticket's own measured table covers.
 *
 * Confirmed against the live repo after the narrowing: topic records read
 * dominance 0.945 (the ticket measured 0.97) and pass/bounce evidence 0.009
 * (measured 0.01), so the detector reproduces the figures the ticket was
 * minted on.
 */
export const RITUAL_CLASSES: RitualClass[] = [
  // Both the promotion script's commits and in-flight spec amendments land
  // here, so the label says so rather than promising a purity the path proxy
  // cannot deliver - the specifier judging the candidate should know the
  // number is mixed.
  { id: 'backlog-promotion', pathPrefix: 'backlog/active/', label: 'backlog active-area edits (promotion and in-flight amendments)' },
  { id: 'backlog-closure', pathPrefix: 'backlog/done/', label: 'backlog closure' },
  { id: 'pass-bounce-evidence', pathPrefix: 'backlog/evidence/', label: 'pass/bounce evidence' },
  { id: 'topic-records', pathPrefix: 'backlog/topics/', label: 'topic records' },
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
 * A class is "named by" a ticket when the ticket DECLARES it, in a
 * `ritual_class:` field carrying the class id — as a scalar or a list.
 *
 * Text matching was tried first and the live backlog refuted it, which is
 * worth recording because the shape of the refutation is the reason for the
 * field. Matching a class's path prefix anywhere in the ticket suppressed
 * `pass-bounce-evidence` on 23 of 104 open tickets, almost all of which merely
 * mention `backlog/evidence/` in passing — a detector suppressed that broadly
 * never fires at all, which is the same silence as not building it.
 * Tightening to the title inverted the failure: the 2026-09-03 sweep's OWN
 * findings, BL-1362 and BL-1363, name neither path in their titles, so the
 * one case invariant 2 exists to handle would not have been suppressed.
 *
 * No prose rule sits between those two, so the ticket declares instead. It is
 * also the moment the knowledge exists: the specifier minting a ticket FROM a
 * candidate knows exactly which class it addresses, and says so.
 *
 * Fails toward firing, deliberately. An undeclared ticket costs the specifier
 * one judgement to dismiss a candidate — which invariant 3 already prices in —
 * whereas over-suppression costs the whole mechanism, silently.
 */
export function ritualClassIsNamedByText(cls: RitualClass, text: string): boolean {
  for (const line of text.split('\n')) {
    const match = /^\s*ritual_class:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const declared = match[1]
      .replace(/[[\]'"]/g, ' ')
      .split(/[\s,]+/)
      .filter((token) => token.length > 0);
    if (declared.includes(cls.id)) {
      return true;
    }
  }
  return false;
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
