// BL-763: GET /lets-talk/meta — a stable-per-process instanceId (+ startedAt)
// so Bubble can detect a bridge bounce and refresh its Let's Talk session.
// The instanceId itself is generated once per startBridge() call (bridgeServer.ts),
// never here — this module only serves whatever it was constructed with.
// Hostname/DNS discovery stays out of scope (BL-716): this route only tells
// the client "you're now talking to a different process instance," never
// anything about reachability.

import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';

export interface LetsTalkMetaStatus {
  instanceId: string;
  startedAt: string;
}

export function buildLetsTalkMetaStatus(instanceId: string, startedAt: string): LetsTalkMetaStatus {
  return { instanceId, startedAt };
}

export function isLetsTalkMetaRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'GET' && (url === '/lets-talk/meta' || url.startsWith('/lets-talk/meta?'));
}

export interface LetsTalkMetaRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

export function createLetsTalkMetaRoutes(
  instanceId: string,
  startedAt: string,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void
): LetsTalkMetaRoute[] {
  return [
    {
      matches: isLetsTalkMetaRoute,
      handle: (req, res, _targetPath, registry) => {
        if (!requireAuth(req, res, registry)) {
          return;
        }
        respond(res, 200, { success: true, ...buildLetsTalkMetaStatus(instanceId, startedAt) });
      },
    },
  ];
}
