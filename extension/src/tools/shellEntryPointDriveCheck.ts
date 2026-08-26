/**
 * BL-747: pure shell entry-point drive check for /pilot land. When a run
 * touches swarmforge/scripts/test/*.sh and the ticket YAML names a non-test
 * .sh entry-point, every named basename must be invoked in a touched test
 * (bash …/name or ./name) — source of a helper alone does not satisfy.
 * IO stays in commitClaimGitReader / pilot-acceptance-gate.
 */

export const PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL =
  'touched shell test does not invoke a ticket-named entry-point script';

export const SHELL_TEST_PATH_RE = /^swarmforge\/scripts\/test\/[^/]+\.sh$/;

export type ShellEntryPointDriveMiss = {
  entryPoint: string;
  testPath: string;
};

export type ShellEntryPointDriveCheckOutcome =
  | {
      checked: true;
      shellTestsScanned: number;
      entryPointsNamed: number;
      miss?: ShellEntryPointDriveMiss;
    }
  | { checked: false };

export function isShellTestPath(relativePath: string): boolean {
  return SHELL_TEST_PATH_RE.test(relativePath.replace(/\\/g, '/'));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripShellLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function stripShellComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map(stripShellLineComment)
    .join('\n');
}

/** True when basename is invoked via bash/sh …/name or ./name (not merely sourced). */
export function testInvokesEntryPoint(testText: string, basename: string): boolean {
  const code = stripShellComments(testText);
  const esc = escapeRegExp(basename);
  const bashOrSh = new RegExp(`(?:^|[\\s;&|(\`])(?:bash|sh)\\s+[^\\n]*${esc}\\b`);
  const dotSlash = new RegExp(`(?:^|[\\s;&|(\`])\\.\\/${esc}\\b`);
  return bashOrSh.test(code) || dotSlash.test(code);
}

function isTestScriptPathFragment(fragment: string): boolean {
  const normalized = fragment.replace(/\\/g, '/');
  return (
    /(?:^|\/)scripts\/test\//.test(normalized) ||
    /(?:^|\/)test\//.test(normalized)
  );
}

/**
 * Non-test .sh basenames named in ticket YAML (description / wiring / acceptance).
 * Paths under scripts/test/ are excluded.
 */
export function extractNamedEntryPoints(ticketYaml: string): string[] {
  const found = new Set<string>();
  const re = /(?:^|[\s"'`(/=])([\w./@+-]+\.sh)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ticketYaml)) !== null) {
    const fragment = match[1];
    if (isTestScriptPathFragment(fragment)) {
      continue;
    }
    const base = fragment.split('/').pop();
    if (base && base.endsWith('.sh')) {
      found.add(base);
    }
  }
  return [...found].sort();
}

export function assessShellEntryPointDrive(input: {
  ticketYaml: string | undefined;
  shellTests: Array<{ path: string; text: string }> | undefined;
}): ShellEntryPointDriveCheckOutcome {
  if (input.ticketYaml === undefined || input.shellTests === undefined) {
    return { checked: false };
  }
  const entryPoints = extractNamedEntryPoints(input.ticketYaml);
  const shellTests = input.shellTests.filter((f) => isShellTestPath(f.path));
  if (entryPoints.length === 0 || shellTests.length === 0) {
    return {
      checked: true,
      shellTestsScanned: shellTests.length,
      entryPointsNamed: entryPoints.length,
    };
  }
  for (const entryPoint of entryPoints) {
    const driven = shellTests.some((t) => testInvokesEntryPoint(t.text, entryPoint));
    if (!driven) {
      return {
        checked: true,
        shellTestsScanned: shellTests.length,
        entryPointsNamed: entryPoints.length,
        miss: { entryPoint, testPath: shellTests[0].path },
      };
    }
  }
  return {
    checked: true,
    shellTestsScanned: shellTests.length,
    entryPointsNamed: entryPoints.length,
  };
}
