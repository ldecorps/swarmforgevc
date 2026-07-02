import * as crypto from 'crypto';

export function generateBridgeToken(): string {
  return crypto.randomBytes(24).toString('hex');
}
