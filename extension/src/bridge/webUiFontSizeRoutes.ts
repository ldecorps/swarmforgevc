// BL-1153: GET/PUT /web-ui-font-size for Mini App sticky font-size choices.
import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import {
  isWebUiFontSizeSurface,
  isWebUiFontSizeWriteRequestShape,
  resolveWebUiFontSizePx,
  writeWebUiFontSizePreference,
  type WebUiFontSizeSurface,
} from './webUiFontSizePreference';

export const WEB_UI_FONT_SIZE_WRITE_MAX_BODY_BYTES = 4 * 1024;

function surfaceFromUrl(url: string): WebUiFontSizeSurface | null {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const surface = new URLSearchParams(query).get('surface');
  return isWebUiFontSizeSurface(surface) ? surface : null;
}

export function isWebUiFontSizeReadRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'GET' && (url === '/web-ui-font-size' || url.startsWith('/web-ui-font-size?'));
}

export function isWebUiFontSizeWriteRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'PUT' && (url === '/web-ui-font-size' || url.startsWith('/web-ui-font-size?'));
}

export function isWebUiFontSizePath(url: string): boolean {
  return url === '/web-ui-font-size' || url.startsWith('/web-ui-font-size?');
}

export interface WebUiFontSizeRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

export function createWebUiFontSizeRoutes(
  requireControlAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { surface: WebUiFontSizeSurface; fontSizePx: number },
    shapeErrorReason: string
  ) => Promise<{ surface: WebUiFontSizeSurface; fontSizePx: number } | null>
): WebUiFontSizeRoute[] {
  return [
    {
      matches: isWebUiFontSizeReadRoute,
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
        respond(res, 200, { success: true, surface, fontSizePx: resolveWebUiFontSizePx(targetPath, surface) });
      },
    },
    {
      matches: isWebUiFontSizeWriteRoute,
      handle: (req, res, targetPath, registry) => {
        if (!requireControlAuth(req, res, registry)) {
          return;
        }
        readValidatedBody(
          req,
          res,
          WEB_UI_FONT_SIZE_WRITE_MAX_BODY_BYTES,
          isWebUiFontSizeWriteRequestShape,
          'expected a JSON body of {surface, fontSizePx}'
        ).then((value) => {
          if (!value) {
            return;
          }
          const write = writeWebUiFontSizePreference(targetPath, value.surface, value.fontSizePx);
          if (!write.ok) {
            respond(res, 400, { success: false, reason: write.reason });
            return;
          }
          respond(res, 200, { success: true, surface: value.surface, fontSizePx: write.fontSizePx });
        });
      },
    },
  ];
}
