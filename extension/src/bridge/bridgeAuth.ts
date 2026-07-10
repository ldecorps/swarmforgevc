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

// BL-094: a plain browser navigation to the holistic UI's root URL cannot
// set an Authorization header, so that one route additionally accepts the
// token via query string (the extension's "open bridge" command includes
// it in the URL it offers). Every other route stays header-only - this
// query-token path never discloses swarm/dev state itself, only unlocks
// the static HTML shell, which then uses the header path for every actual
// data/SSE request it makes client-side.
export function isAuthorizedByQueryToken(queryToken: string | undefined, token: string): boolean {
  if (!queryToken) {
    return false;
  }
  return timingSafeStringEqual(queryToken, token);
}
