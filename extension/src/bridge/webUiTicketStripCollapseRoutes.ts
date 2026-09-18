// BL-1542: GET/PUT /web-ui-ticket-strip-collapsed for the live screen's
// ticket-strip collapse control, host-persisted per surface beside
// fontSizePx (webUiFontSizePreference.ts) - Architecture Rule 3, never
// browser storage. Mirrors webUiFontSizeRoutes.ts's own shape.
import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import {
  isWebUiFontSizeSurface,
  isWebUiTicketStripCollapsedWriteRequestShape,
  resolveWebUiTicketStripCollapsed,
  writeWebUiTicketStripCollapsed,
  type WebUiFontSizeSurface,
} from './webUiFontSizePreference';

export const WEB_UI_TICKET_STRIP_COLLAPSED_WRITE_MAX_BODY_BYTES = 4 * 1024;

function surfaceFromUrl(url: string): WebUiFontSizeSurface | null {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const surface = new URLSearchParams(query).get('surface');
  return isWebUiFontSizeSurface(surface) ? surface : null;
}

export function isWebUiTicketStripCollapsedReadRoute(req: http.IncomingMessage, url: string): boolean {
  return (
    req.method === 'GET' &&
    (url === '/web-ui-ticket-strip-collapsed' || url.startsWith('/web-ui-ticket-strip-collapsed?'))
  );
}

export function isWebUiTicketStripCollapsedWriteRoute(req: http.IncomingMessage, url: string): boolean {
  return (
    req.method === 'PUT' &&
    (url === '/web-ui-ticket-strip-collapsed' || url.startsWith('/web-ui-ticket-strip-collapsed?'))
  );
}

export function isWebUiTicketStripCollapsedPath(url: string): boolean {
  return url === '/web-ui-ticket-strip-collapsed' || url.startsWith('/web-ui-ticket-strip-collapsed?');
}

export interface WebUiTicketStripCollapsedRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

export function createWebUiTicketStripCollapsedRoutes(
  requireControlAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { surface: WebUiFontSizeSurface; collapsed: boolean },
    shapeErrorReason: string
  ) => Promise<{ surface: WebUiFontSizeSurface; collapsed: boolean } | null>
): WebUiTicketStripCollapsedRoute[] {
  return [
    {
      matches: isWebUiTicketStripCollapsedReadRoute,
      handle: (req, res, targetPath, registry) => {
        if (!requireControlAuth(req, res, registry)) {
          return;
        }
        const url = req.url ?? '/';
        const surface = surfaceFromUrl(url);
        if (!surface) {
          respond(res, 400, { success: false, reason: 'expected surface query parameter' });
          return;
        }
        respond(res, 200, { success: true, surface, collapsed: resolveWebUiTicketStripCollapsed(targetPath, surface) });
      },
    },
    {
      matches: isWebUiTicketStripCollapsedWriteRoute,
      handle: (req, res, targetPath, registry) => {
        if (!requireControlAuth(req, res, registry)) {
          return;
        }
        readValidatedBody(
          req,
          res,
          WEB_UI_TICKET_STRIP_COLLAPSED_WRITE_MAX_BODY_BYTES,
          isWebUiTicketStripCollapsedWriteRequestShape,
          'expected a JSON body of {surface, collapsed}'
        ).then((value) => {
          if (!value) {
            return;
          }
          const write = writeWebUiTicketStripCollapsed(targetPath, value.surface, value.collapsed);
          if (!write.ok) {
            respond(res, 400, { success: false, reason: write.reason });
            return;
          }
          respond(res, 200, { success: true, surface: value.surface, collapsed: write.collapsed });
        });
      },
    },
  ];
}
