import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { buildBridgeState, BridgeState } from './bridgeState';
import { isAuthorizedRequest } from './bridgeAuth';
import { computeStageDwellReport } from '../metrics/swarmMetrics';
import { parseRolesTsv } from '../swarm/swarmState';

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

function buildStageDwellReport(targetPath: string): unknown {
  const rolesTsvPath = path.join(targetPath, '.swarmforge', 'roles.tsv');
  let rolesTsv: string;
  try {
    rolesTsv = fs.readFileSync(rolesTsvPath, 'utf8');
  } catch {
    return {};
  }
  const roles = parseRolesTsv(rolesTsv);
  return computeStageDwellReport(targetPath, roles, 24 * 60 * 60 * 1000, Date.now());
}

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

      if (!isAuthorizedRequest(req.headers.authorization, token)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (url === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const snapshot = lastSnapshot ?? JSON.stringify(buildBridgeState(targetPath, runLogPath));
        res.write(`data: ${snapshot}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (isStateRoute(url)) {
        const state = buildBridgeState(targetPath, runLogPath);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(stateForRoute(state, url)));
        return;
      }

      if (url === '/metrics/stage-dwell') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(buildStageDwellReport(targetPath)));
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
