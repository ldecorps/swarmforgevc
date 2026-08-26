// BL-217: Svix webhook signature verification, the scheme Resend Inbound
// signs with. Pure over provided inputs - no network, no clock - per the
// ticket's constraint. HMAC-SHA256 over "<id>.<timestamp>.<rawBody>" using
// the base64 portion of the "whsec_..." secret; svix-signature may carry
// several space-separated "v1,<base64sig>" candidates and any match counts
// (https://docs.svix.com/receiving/verifying-payloads/how-manual).

import * as crypto from 'crypto';

export interface SvixHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

function timingSafeBase64Equal(a: string, b: string): boolean {
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'base64');
    bufB = Buffer.from(b, 'base64');
  } catch {
    return false;
  }
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifySvixSignature(headers: SvixHeaders, rawBody: string, secret: string): boolean {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${headers.svixId}.${headers.svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  const candidates = headers.svixSignature
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter((candidate): candidate is string => Boolean(candidate));

  return candidates.some((candidate) => timingSafeBase64Equal(candidate, expected));
}

export const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 300;

// A valid HMAC over an old svix-timestamp is not the same as a fresh
// delivery: verifySvixSignature alone lets a captured, validly-signed
// request be replayed indefinitely. Callers must check both. Kept as its
// own function (not folded into verifySvixSignature) so the HMAC check
// stays single-purpose and this stays independently testable/tunable.
export function isTimestampFresh(
  svixTimestamp: string,
  nowMs: number,
  toleranceSeconds: number = SVIX_TIMESTAMP_TOLERANCE_SECONDS
): boolean {
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const nowSeconds = nowMs / 1000;
  return Math.abs(nowSeconds - timestampSeconds) <= toleranceSeconds;
}
