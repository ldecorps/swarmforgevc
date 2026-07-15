// BL-414: a topic's title carries a coarse, glanceable "last updated N ago"
// suffix - pure bucket/decision logic only (no I/O; mirrors topicIcon.ts's
// own pure/adapter split, with topicTitleSync.ts as the I/O half). The
// human accepted a title suffix over an (infeasible) colour gradient, and
// the icon is already taken by ticket STATE (BL-342), so the age rides the
// title instead.
//
// BUCKETED + CHANGE-GATED: Telegram rate-limits editForumTopic and a rename
// posts visible churn, so the exact "Nh"/"Nd" text is rendered ONCE, at the
// moment a topic crosses into a new bucket, and then held fixed (even as it
// grows further stale within that SAME bucket) until the bucket changes
// again. A caller must persist the returned bucket and pass it back in as
// `lastAnnouncedBucket` on the next call - decideTitleAge itself holds no
// state of its own.
export type StalenessBucket = 'fresh' | 'hours' | 'day' | 'stale';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STALE_THRESHOLD_MS = 3 * DAY_MS;

export function stalenessBucket(elapsedMs: number): StalenessBucket {
  const clamped = Math.max(0, elapsedMs);
  if (clamped < HOUR_MS) {
    return 'fresh';
  }
  if (clamped < DAY_MS) {
    return 'hours';
  }
  if (clamped < STALE_THRESHOLD_MS) {
    return 'day';
  }
  return 'stale';
}

// Matches exactly the tail composeTitleWithAge below can itself produce -
// stripped before every re-compose so the suffix can never accumulate
// (BASE-TITLE SAFETY), regardless of how many times a title has already
// been round-tripped through this module.
const AGE_SUFFIX_PATTERN = / · (\d+[hd] ago|3d\+ ago)$/;

export function stripAgeSuffix(title: string): string {
  return title.replace(AGE_SUFFIX_PATTERN, '');
}

// fresh renders NO suffix at all (the freshest state needs no visual
// noise) - composeTitleWithAge below treats an empty suffix as "the bare
// base title", which is also what makes a fresh-bucket edit visibly STRIP
// a previously-shown stale suffix rather than replace it with a "just now"
// tag.
function ageSuffixText(bucket: StalenessBucket, elapsedMs: number): string {
  switch (bucket) {
    case 'fresh':
      return '';
    case 'hours':
      return `${Math.max(1, Math.floor(elapsedMs / HOUR_MS))}h ago`;
    case 'day':
      return `${Math.max(1, Math.floor(elapsedMs / DAY_MS))}d ago`;
    case 'stale':
      return '3d+ ago';
  }
}

export function composeTitleWithAge(rawTitle: string, bucket: StalenessBucket, elapsedMs: number): string {
  const base = stripAgeSuffix(rawTitle);
  const suffix = ageSuffixText(bucket, elapsedMs);
  return suffix === '' ? base : `${base} · ${suffix}`;
}

export interface TitleAgeDecision {
  bucket: StalenessBucket;
  // Present only when `bucket` differs from the caller's lastAnnouncedBucket
  // - a caller must treat title === undefined as "no edit needed" and must
  // not call editForumTopic at all in that case (the whole point of the
  // change-gate).
  title?: string;
}

export function decideTitleAge(
  rawTitle: string,
  lastUpdateMs: number,
  nowMs: number,
  lastAnnouncedBucket: StalenessBucket | undefined
): TitleAgeDecision {
  const elapsedMs = nowMs - lastUpdateMs;
  const bucket = stalenessBucket(elapsedMs);
  if (bucket === lastAnnouncedBucket) {
    return { bucket };
  }
  return { bucket, title: composeTitleWithAge(rawTitle, bucket, elapsedMs) };
}
