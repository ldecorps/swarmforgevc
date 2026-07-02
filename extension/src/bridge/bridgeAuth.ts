import * as crypto from 'crypto';

const BEARER_PREFIX = 'Bearer ';

export function isAuthorizedRequest(authHeader: string | undefined, token: string): boolean {
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const provided = Buffer.from(authHeader.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}
