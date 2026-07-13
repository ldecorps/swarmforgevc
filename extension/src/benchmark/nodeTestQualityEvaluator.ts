import { execFileSync } from 'child_process';
import { QualityEvaluator, QualityResult, TaskSpec } from './types';

// Pure: parses node's own `--test-reporter=tap` summary footer ("# tests N"
// / "# pass N") - always requested explicitly (never the TTY-dependent
// default reporter), so parsing is stable regardless of how the
// evaluator's own stdout is captured. Missing/unparsable lines score as 0
// of 0, never a crash - a model that leaves the fixture unrunnable is a
// real (worst-possible) quality result, not a harness failure.
export function parseNodeTestTapSummary(output: string): QualityResult {
  const passMatch = output.match(/^# pass (\d+)$/m);
  const totalMatch = output.match(/^# tests (\d+)$/m);
  return {
    passed: passMatch ? Number(passMatch[1]) : 0,
    total: totalMatch ? Number(totalMatch[1]) : 0,
  };
}

interface ExecFileError {
  stdout?: string;
}

// Node's own test runner stamps NODE_TEST_CONTEXT into the environment of
// a process it is running under; if that leaks into this evaluator's own
// child `node --test` invocation (e.g. because the evaluator itself is
// exercised from inside an acceptance/unit run under `node --test`), the
// child treats itself as a recursive nested run and silently skips
// executing the file entirely - it emits no per-test TAP lines at all, so
// parseNodeTestTapSummary reads a false "0 of 0" rather than the fixture's
// real result. The evaluator's child must always run as a fresh top-level
// test run regardless of the caller's own process context, so this strips
// every NODE_TEST_* var before spawning it.
function childTestEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST_')) {
      delete env[key];
    }
  }
  return env;
}

function runNodeTest(cwd: string, testFile: string): string {
  try {
    return execFileSync('node', ['--test', '--test-reporter=tap', testFile], { cwd, encoding: 'utf8', env: childTestEnv() });
  } catch (error) {
    // `node --test` exits non-zero when any test fails - the TAP summary
    // is still on stdout, carried on the thrown error object.
    return (error as ExecFileError).stdout ?? '';
  }
}

export function createNodeTestQualityEvaluator(): QualityEvaluator {
  return {
    async evaluate(cwd: string, task: TaskSpec): Promise<QualityResult> {
      return parseNodeTestTapSummary(runNodeTest(cwd, task.testFile));
    },
  };
}
