import * as cp from 'child_process';

export interface PrResult {
  success: boolean;
  url?: string;
  message: string;
}

export function getCurrentBranch(targetPath: string): string | undefined {
  try {
    const out = cp.execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  } catch {
    return undefined;
  }
}

export function buildPrArgs(title: string, baseBranch = 'main'): string[] {
  return ['pr', 'create', '--title', title, '--base', baseBranch, '--fill'];
}

export function openPullRequest(
  targetPath: string,
  title: string,
  baseBranch = 'main'
): PrResult {
  try {
    const args = buildPrArgs(title, baseBranch);
    const output = cp.execSync(['gh', ...args].join(' '), {
      cwd: targetPath,
      encoding: 'utf8',
    });
    const url = output
      .trim()
      .split('\n')
      .find((l) => l.startsWith('https://'));
    return {
      success: true,
      url,
      message: url ? `PR created: ${url}` : 'PR created.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to create PR: ${message}` };
  }
}
