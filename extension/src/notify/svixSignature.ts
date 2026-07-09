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
