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

// BL-094/BL-522: a plain browser (or Telegram Mini App) navigation cannot
// set an Authorization header, so selected routes additionally accept the
// token via query string (the extension's "open bridge" command and the
// Resident Spy Mini App URL include it). The root HTML shell uses the
// token client-side for bearer fetches; /resident-pane accepts the query
// token server-side because its poll cannot set a header. Other data
// routes stay header-only.
export function isAuthorizedByQueryToken(queryToken: string | undefined, token: string): boolean {
  if (!queryToken) {
    return false;
  }
  return timingSafeStringEqual(queryToken, token);
}
