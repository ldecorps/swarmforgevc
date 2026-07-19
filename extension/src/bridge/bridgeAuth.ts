import * as crypto from 'crypto';

const BEARER_PREFIX = 'Bearer ';

export function isAuthorizedToken(providedToken: string | undefined | null, token: string): boolean {
  if (!providedToken) {
    return false;
  }
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

export function isAuthorizedRequest(authHeader: string | undefined, token: string): boolean {
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return isAuthorizedToken(authHeader.slice(BEARER_PREFIX.length), token);
}
