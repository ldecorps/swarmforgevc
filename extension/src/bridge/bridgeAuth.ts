import * as crypto from 'crypto';

const BEARER_PREFIX = 'Bearer ';

function timingSafeStringEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// BL-241: factored out of isAuthorizedRequest so deviceRegistry-based
// (multi-device) auth checks can extract the same bearer token this
// single-token check always has, without duplicating the prefix logic.
export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  return authHeader.slice(BEARER_PREFIX.length);
}

export function isAuthorizedRequest(authHeader: string | undefined, token: string): boolean {
  const provided = extractBearerToken(authHeader);
  if (provided === undefined) {
    return false;
  }
  return timingSafeStringEqual(provided, token);
}

// BL-094/BL-522/BL-526: a plain browser (or Telegram Mini App) navigation
// cannot set an Authorization header, so selected routes additionally
// accept the token via query string (the extension's "open bridge" command
// and Mini App URLs include it). The root HTML shell uses the token
// client-side for bearer fetches; /resident-pane and /pipeline-board accept
// the query token server-side because their polls cannot set a header.
// Other data routes stay header-only.
export function isAuthorizedByQueryToken(queryToken: string | undefined, token: string): boolean {
  if (!queryToken) {
    return false;
  }
  return timingSafeStringEqual(queryToken, token);
}

/** Read credential from `?bearer=` (preferred) or legacy `?token=` on a request URL. */
export function parseQueryCredential(url: string): string | undefined {
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    const queryCred = params.get('bearer') ?? params.get('token') ?? undefined;
    if (queryCred) {
      return queryCred;
    }
  }

  // Some edge/proxy setups normalize or drop query strings on selected paths.
  // Support a path credential fallback for resident-pane polling:
  //   /resident-pane/<credential>
  let pathname = (url.split('?')[0] ?? '').split('#')[0] ?? '';
  // Proxies may forward absolute-form targets (e.g. https://host/path).
  // Normalize to pathname so resident-pane path credential parsing still works.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      // Keep raw pathname fallback when URL parsing fails.
    }
  }
  const pathMatch = pathname.match(/^\/resident-pane\/([^/?#]+)/);
  if (!pathMatch) {
    return undefined;
  }
  try {
    return decodeURIComponent(pathMatch[1]);
  } catch {
    return pathMatch[1];
  }
}

export function formatQueryCredential(credential: string): string {
  return `?bearer=${encodeURIComponent(credential)}`;
}
