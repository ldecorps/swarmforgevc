import * as cp from 'child_process';

export interface PrResult {
  success: boolean;
  url?: string;
  message: string;
}

const EXEC_ENCODING = 'utf8' as const;
const GIT_DETACHED = 'HEAD';
const HTTPS_PREFIX = 'https://';
const DEFAULT_BASE_BRANCH = 'main';

export function getCurrentBranch(targetPath: string): string | undefined {
  try {
    const out = cp.execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetPath,
      encoding: EXEC_ENCODING,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.trim();
    return branch && branch !== GIT_DETACHED ? branch : undefined;
  } catch {
    return undefined;
  }
}

export function buildPrArgs(title: string, baseBranch = DEFAULT_BASE_BRANCH): string[] {
  return ['pr', 'create', '--title', title, '--base', baseBranch, '--fill'];
}

function extractPrUrl(output: string): string | undefined {
  return output
    .trim()
    .split('\n')
    .find((l) => l.startsWith(HTTPS_PREFIX));
}

export function openPullRequest(
  targetPath: string,
  title: string,
  baseBranch = DEFAULT_BASE_BRANCH
): PrResult {
  try {
    const args = buildPrArgs(title, baseBranch);
    const cmd = `gh ${args.join(' ')}`;
    const output = cp.execSync(cmd, {
      cwd: targetPath,
      encoding: EXEC_ENCODING,
    });
    const url = extractPrUrl(output);
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
