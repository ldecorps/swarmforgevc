// BL-834: pure helpers for the Bubble Host thinking page — state, feed
// rendering, and static shell checks for acceptance/property tests.
import type { HostActivityState } from './hostActivityFeed';

export type HostPageViewState = 'working' | 'quiet' | 'unreachable';

export const BUBBLE_HOST_SHELL_ROUTE = '/host';
export const HOST_ACTIVITY_FEED_ROUTE = '/host-activity';
export const HOST_ACTIVITY_SSE_ROUTE = '/events';

export const BUBBLE_HOST_READ_ROUTE_PATHS = [
  BUBBLE_HOST_SHELL_ROUTE,
  HOST_ACTIVITY_FEED_ROUTE,
  HOST_ACTIVITY_SSE_ROUTE,
] as const;

/** Endpoints that mutate the host agent session — the Host page must never call these. */
export const HOST_SESSION_MUTATION_ROUTE_PREFIXES = [
  '/lets-talk/turn',
  '/lets-talk/new-session',
  '/gate-answer',
] as const;

const STEERING_AFFORDANCE_PATTERN =
  /\b(stop|barge|interrupt|steer|cancel turn|abort turn|new-session)\b/i;

const PERPETUAL_LOADING_MARKERS = [
  'class="loading"',
  "class='loading'",
  'aria-busy="true"',
  'perpetual-spinner',
  'Loading…',
];

export interface HostPageClientRender {
  viewState: HostPageViewState;
  lines: string[];
  statusMessage: string;
  unreachableReason?: string;
}

export function deriveHostPageViewState(
  feed: HostActivityState,
  unreachableReason?: string
): HostPageViewState {
  if (unreachableReason) {
    return 'unreachable';
  }
  return feed.status === 'active' ? 'working' : 'quiet';
}

export function formatHostUnreachableMessage(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return 'Could not read the host activity feed — the bridge did not say why.';
  }
  if (/^HTTP\s+\d{3}$/i.test(trimmed) || /^\d{3}$/.test(trimmed)) {
    return `Could not read the host activity feed — bridge returned ${trimmed}. Check pairing and bridge reachability.`;
  }
  if (/^could not read the host activity feed/i.test(trimmed)) {
    return trimmed;
  }
  return `Could not read the host activity feed — ${trimmed}`;
}

export function hostUnreachableMessageIsBareStatusCode(message: string): boolean {
  const trimmed = message.trim();
  return /^HTTP\s+\d{3}$/i.test(trimmed) || /^\d{3}$/.test(trimmed);
}

export function escapeHostFeedLine(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHostActivityLines(lines: readonly string[]): string {
  return lines
    .map(
      (line) =>
        `<div class="host-line" data-feed-line="1">${escapeHostFeedLine(line)}</div>`
    )
    .join('');
}

export function hostPageRenderedLinesAreSubsetOfFeed(
  renderedLines: readonly string[],
  feedLines: readonly string[]
): boolean {
  const feedSet = new Set(feedLines);
  return renderedLines.every((line) => feedSet.has(line));
}

export function simulateHostPageRender(
  feed: HostActivityState,
  unreachableReason?: string
): HostPageClientRender {
  const viewState = deriveHostPageViewState(feed, unreachableReason);
  if (viewState === 'unreachable') {
    const statusMessage = formatHostUnreachableMessage(unreachableReason ?? '');
    return {
      viewState,
      lines: [],
      statusMessage,
      unreachableReason: statusMessage,
    };
  }
  if (viewState === 'quiet') {
    return {
      viewState,
      lines: [],
      statusMessage: 'Host is quiet — no host agent session is running.',
    };
  }
  const activeFeed = feed as Extract<HostActivityState, { status: 'active' }>;
  return {
    viewState,
    lines: activeFeed.lines.slice(),
    statusMessage: 'Host agent is working.',
  };
}

export function parseHostPageViewStateFromHtml(html: string): HostPageViewState | null {
  const match = html.match(/data-host-state="(working|quiet|unreachable)"/);
  return match ? (match[1] as HostPageViewState) : null;
}

export function bubbleHostShellReferencesLivePush(html: string): boolean {
  return (
    html.includes(HOST_ACTIVITY_SSE_ROUTE) &&
    html.includes('host-activity') &&
    html.includes('attachHostActivityStream')
  );
}

export function bubbleHostShellHasPerpetualLoading(html: string): boolean {
  return PERPETUAL_LOADING_MARKERS.some((marker) => html.includes(marker));
}

export function bubbleHostShellExposesSteering(html: string): boolean {
  if (STEERING_AFFORDANCE_PATTERN.test(html)) {
    return true;
  }
  return (
    html.includes('type="submit"') &&
    /\b(stop|barge|interrupt|steer)\b/i.test(html)
  );
}

export function bubbleHostShellReferencesHostMutationEndpoint(html: string): boolean {
  return HOST_SESSION_MUTATION_ROUTE_PREFIXES.some((routePrefix) => html.includes(routePrefix));
}

export function bubbleHostRoutesAreReadOnly(
  methodsByPath: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  for (const routePath of BUBBLE_HOST_READ_ROUTE_PATHS) {
    const methods = methodsByPath.get(routePath);
    if (!methods) {
      continue;
    }
    for (const method of methods) {
      if (writeMethods.has(method.toUpperCase())) {
        return false;
      }
    }
  }
  return true;
}
