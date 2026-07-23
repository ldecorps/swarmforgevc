// Cross-process wake signal for the front-desk concierge tick loop. The
// bridge's paused-pager Approve route runs in a separate process from the
// Telegram poll loop, so it drops a timestamp here; the tick loop consumes
// it after each sleep and runs an extra tick immediately.

import * as fs from 'fs';
import * as path from 'path';

export function conciergeTickRequestPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'concierge-tick-requested');
}

export function requestConciergeTick(targetPath: string, nowMs: number = Date.now()): void {
  const file = conciergeTickRequestPath(targetPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(nowMs));
}

export function consumeConciergeTickRequest(targetPath: string): boolean {
  const file = conciergeTickRequestPath(targetPath);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
