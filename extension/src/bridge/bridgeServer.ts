import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { buildBridgeState, BridgeState } from './bridgeState';
import { isAuthorizedRequest, isAuthorizedToken } from './bridgeAuth';
import { buildResidentSpyHtml } from './miniappHtml';
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

interface BridgeRequestContext {
  targetPath: string;
  runLogPath: string;
  token: string;
  sseClients: Set<http.ServerResponse>;
  getLastSnapshot: () => string | undefined;
}

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

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requestAuthorized(req: http.IncomingMessage, queryToken: string | null, token: string): boolean {
  return isAuthorizedRequest(req.headers.authorization, token) || isAuthorizedToken(queryToken, token);
}

function serveEvents(req: http.IncomingMessage, res: http.ServerResponse, context: BridgeRequestContext): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const snapshot = context.getLastSnapshot() ?? JSON.stringify(buildBridgeState(context.targetPath, context.runLogPath));
  res.write(`data: ${snapshot}\n\n`);
  context.sseClients.add(res);
  req.on('close', () => context.sseClients.delete(res));
}

function serveResidentSpy(res: http.ServerResponse, parsedUrl: URL, context: BridgeRequestContext): void {
  const state = buildBridgeState(context.targetPath, context.runLogPath);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(buildResidentSpyHtml(state, {
    view: parsedUrl.searchParams.get('view') ?? undefined,
    token: parsedUrl.searchParams.get('token') ?? undefined,
  }));
}

function serveStateRoute(res: http.ServerResponse, route: StateRoute, context: BridgeRequestContext): void {
  const state = buildBridgeState(context.targetPath, context.runLogPath);
  writeJson(res, 200, stateForRoute(state, route));
}

function serveAuthorizedRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL,
  context: BridgeRequestContext
): boolean {
  const url = parsedUrl.pathname;
  if (url === '/events') {
    serveEvents(req, res, context);
    return true;
  }
  if (url === '/resident-spy') {
    serveResidentSpy(res, parsedUrl, context);
    return true;
  }
  if (isStateRoute(url)) {
    serveStateRoute(res, url, context);
    return true;
  }
  if (url === '/metrics/stage-dwell') {
    writeJson(res, 200, buildStageDwellReport(context.targetPath));
    return true;
  }
  return false;
}

function handleBridgeRequest(req: http.IncomingMessage, res: http.ServerResponse, context: BridgeRequestContext): void {
  const parsedUrl = new URL(req.url ?? '/', `http://${LOCALHOST}`);
  const queryToken = parsedUrl.searchParams.get('token');

  if (!requestAuthorized(req, queryToken, context.token)) {
    writeJson(res, 401, { error: 'unauthorized' });
    return;
  }

  if (!serveAuthorizedRoute(req, res, parsedUrl, context)) {
    writeJson(res, 404, { error: 'not_found' });
  }
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

    const context: BridgeRequestContext = {
      targetPath,
      runLogPath,
      token,
      sseClients,
      getLastSnapshot: () => lastSnapshot,
    };

    const server = http.createServer((req, res) => handleBridgeRequest(req, res, context));

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
