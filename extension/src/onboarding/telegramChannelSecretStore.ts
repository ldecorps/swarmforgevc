import * as fs from 'fs';
import * as path from 'path';

// BL-380: the target's Telegram bot token must never be written into the
// target's own working directory or a commit (local-engineering secrets
// rule) - unlike the chat id and negotiation topic id (persisted INSIDE the
// target's own .swarmforge/, see telegramChannelStore.ts), the token lives
// only in this host-side file, one entry per target repo path so a second
// onboarded target's own token can never collide with or overwrite the
// first's (BL-380 scenario 05). Mirrors recruiter/secretStore.ts's own
// "reject a path inside the target working tree" enforcement, structurally
// checked rather than left as a caller-discipline comment (that exact gap
// was already bounced once there, architect bounce 2d96adcb10).
function isInsideTargetWorkingTree(secretsFilePath: string, targetRepoPath: string): boolean {
  const resolvedRoot = path.resolve(targetRepoPath);
  const resolvedTarget = path.resolve(secretsFilePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readExisting(secretsFilePath: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(secretsFilePath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function storeTelegramBotToken(secretsFilePath: string, targetRepoPath: string, botToken: string): void {
  if (isInsideTargetWorkingTree(secretsFilePath, targetRepoPath)) {
    throw new Error(
      `refusing to store a Telegram bot token inside the target working directory (${path.resolve(targetRepoPath)}) - the host secret store must live outside it`
    );
  }
  fs.mkdirSync(path.dirname(secretsFilePath), { recursive: true });
  const existing = readExisting(secretsFilePath);
  existing[targetRepoPath] = botToken;
  fs.writeFileSync(secretsFilePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
}
