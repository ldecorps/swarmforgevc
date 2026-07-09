import * as http from 'http';
import { buildBridgeState, buildDeliveryMetricsState, buildCostTelemetryState, buildHolisticState, BridgeState } from './bridgeState';
import { isAuthorizedRequest, isAuthorizedByQueryToken } from './bridgeAuth';
import { getHolisticUiHtml } from './holisticUiHtml';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const LOCALHOST = '127.0.0.1';

export interface BridgeHandle {
  port: number;
  token: string;
  stop: () => void;
}

export interface StartBridgeOptions {
  port?: number;
  pollIntervalMs?: number;
}

type StateRoute = '/pipeline' | '/agents' | '/backlog' | '/runlog';

function stateForRoute(state: BridgeState, route: StateRoute): unknown {
  switch (route) {
    case '/pipeline':
      return state.pipeline;
    case '/agents':
      return state.agents;
    case '/backlog':
      return state.backlog;
    case '/runlog':
      return state.runLog;
  }
}

function isStateRoute(url: string): url is StateRoute {
  return url === '/pipeline' || url === '/agents' || url === '/backlog' || url === '/runlog';
}

// Split out of the request handler below so its own complexity stays under
// the CRAP<=6 gate (BL-096's added /metrics branch pushed it to 7) - the
// cached-snapshot-or-compute-fresh choice for a new SSE subscriber.
function resolveEventsSnapshot(lastSnapshot: string | undefined, targetPath: string, runLogPath: string): string {
  return lastSnapshot ?? JSON.stringify(buildBridgeState(targetPath, runLogPath));
}

function isRootPath(url: string): boolean {
  return url === '/' || url.startsWith('/?');
}

function queryToken(url: string): string | undefined {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return undefined;
  }
  return new URLSearchParams(url.slice(queryIndex + 1)).get('token') ?? undefined;
}

// BL-094: every route stays header-only EXCEPT the root HTML shell, which a
// plain browser navigation cannot attach a header to - it additionally
// accepts the token via query string (see bridgeAuth.ts's own comment).
function isAuthorizedForUrl(authHeader: string | undefined, url: string, token: string): boolean {
  if (isAuthorizedRequest(authHeader, token)) {
    return true;
  }
  return isRootPath(url) && isAuthorizedByQueryToken(queryToken(url), token);
}

interface JsonRoute {
  matches: (url: string) => boolean;
  compute: (url: string) => unknown;
}

// Every route below except /events follows the same "match, compute JSON,
// respond 200" shape. A data-driven table instead of one `if` per route
// keeps the request handler's own complexity flat as routes are added -
// BL-096's /metrics and BL-100's /cost-telemetry each pushed the handler's
// per-branch version back over the CRAP<=6 gate in turn; a future route
// only ever adds a table entry here, never another handler branch.
function buildJsonRoutes(targetPath: string, runLogPath: string): JsonRoute[] {
  return [
    {
      matches: isStateRoute,
      compute: (url) => stateForRoute(buildBridgeState(targetPath, runLogPath), url as StateRoute),
    },
    {
      // BL-096: computed fresh per-request only, deliberately outside
      // buildBridgeState/the SSE poll loop above (git-history-walk cost -
      // see buildDeliveryMetricsState's own comment).
      matches: (url) => url === '/metrics',
      compute: () => buildDeliveryMetricsState(targetPath),
    },
    {
      // BL-100: same posture as /metrics - transcript + telemetry reads are
      // too expensive for the SSE poll loop, computed only on direct request.
      matches: (url) => url === '/cost-telemetry',
      compute: () => buildCostTelemetryState(targetPath),
    },
  ];
}

export function startBridge(
  targetPath: string,
  runLogPath: string,
  token: string,
  options: StartBridgeOptions = {}
): Promise<BridgeHandle> {
  const port = options.port ?? 0;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return new Promise((resolve) => {
    const sseClients = new Set<http.ServerResponse>();
    let lastSnapshot: string | undefined;

    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';

      if (!isAuthorizedForUrl(req.headers.authorization, url, token)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (isRootPath(url)) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          // Inline style/script only, matching the page's own "self-contained,
          // no external fetch" scope note - no external origin needs allowing.
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
        res.end(getHolisticUiHtml());
        return;
      }

      if (url === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const snapshot = resolveEventsSnapshot(lastSnapshot, targetPath, runLogPath);
        res.write(`data: ${snapshot}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      const jsonRoute = buildJsonRoutes(targetPath, runLogPath).find((route) => route.matches(url));
      if (jsonRoute) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(jsonRoute.compute(url)));
        return;
      }

      // BL-094: same posture as /metrics/cost-telemetry - git-history +
      // handoff-state reads, too expensive for the SSE poll loop.
      if (url === '/holistic') {
        const state = buildHolisticState(targetPath, runLogPath);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    const poll = setInterval(() => {
      if (sseClients.size === 0) {
        return;
      }
      const snapshot = JSON.stringify(buildBridgeState(targetPath, runLogPath));
      if (snapshot === lastSnapshot) {
        return;
      }
      lastSnapshot = snapshot;
      for (const client of sseClients) {
        client.write(`data: ${snapshot}\n\n`);
      }
    }, pollIntervalMs);
    poll.unref();

    server.listen(port, LOCALHOST, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        token,
        stop: () => {
          clearInterval(poll);
          for (const client of sseClients) {
            client.end();
          }
          sseClients.clear();
          server.close();
        },
      });
    });
  });
}
