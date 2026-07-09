// BL-132: Stryker Reporter plugin that writes mutation progress straight to
// a durable JSON file via Stryker's own Reporter lifecycle hooks, instead of
// tailing the terminal "progress" reporter's text (which renders nothing
// once redirected away from a TTY - see the `progress` package's `if
// (!this.stream.isTTY) return;` guard - exactly the ad-hoc-log-file
// scenario this ticket is fixing). Registered as a plugin in
// stryker-plugin.ts; see extension/stryker.config.json's "plugins" array.

import type { MutantResult, MutationTestingPlanReadyEvent, Reporter } from '@stryker-mutator/api/report';
import * as path from 'path';
import {
  MutationProgressState,
  buildProgressRecord,
  initMutationProgressState,
  recordMutantTested,
} from './mutationProgress';
import { defaultProgressFilePath, writeProgressRecord } from './mutationProgressFile';

const RUN_PLAN = 'Run';

export interface MutationProgressReporterDeps {
  now?: () => number;
  role?: string;
  filePath?: string;
  write?: (filePath: string, record: ReturnType<typeof buildProgressRecord>) => void;
  mutateFile?: string;
}

// role has its own two-hop fallback (explicit dep, then env var, then a
// default) - split out so its branch count doesn't compound with
// resolveReporterConfig's own, keeping both (and the constructor) under the
// CRAP threshold independently rather than concentrating every `??` in one
// function.
function resolveRole(deps: Pick<MutationProgressReporterDeps, 'role'>, env: NodeJS.ProcessEnv): string {
  return deps.role ?? env.SWARMFORGE_ROLE ?? 'unknown';
}

export interface ResolvedReporterConfig {
  now: () => number;
  filePath: string;
  write: (filePath: string, record: ReturnType<typeof buildProgressRecord>) => void;
  mutateFile: string | undefined;
}

// Pure: resolves every constructor dependency from explicit overrides, then
// environment/default fallbacks, given an already-computed repoRoot. Kept
// free of `new Date()`/fs/process access beyond the passed-in env so it's
// directly unit-testable without instantiating the Reporter class.
export function resolveReporterConfig(
  deps: MutationProgressReporterDeps,
  env: NodeJS.ProcessEnv,
  repoRoot: string
): ResolvedReporterConfig {
  const role = resolveRole(deps, env);
  return {
    now: deps.now ?? Date.now,
    filePath: deps.filePath ?? defaultProgressFilePath(repoRoot, role),
    write: deps.write ?? writeProgressRecord,
    mutateFile: deps.mutateFile ?? env.STRYKER_MUTATE_FILE,
  };
}

export class MutationProgressReporter implements Reporter {
  private state: MutationProgressState | undefined;
  private readonly now: () => number;
  private readonly filePath: string;
  private readonly write: (filePath: string, record: ReturnType<typeof buildProgressRecord>) => void;
  private readonly mutateFile: string | undefined;

  constructor(deps: MutationProgressReporterDeps = {}) {
    // Compiled to out/mutation/mutationProgressReporter.js: out -> extension -> repo root.
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const config = resolveReporterConfig(deps, process.env, repoRoot);
    this.now = config.now;
    this.filePath = config.filePath;
    this.write = config.write;
    this.mutateFile = config.mutateFile;
  }

  public onMutationTestingPlanReady(event: MutationTestingPlanReadyEvent): void {
    const total = event.mutantPlans.filter((plan) => plan.plan === RUN_PLAN).length;
    this.state = initMutationProgressState(total, this.now());
    this.flush(this.state, 'running');
  }

  public onMutantTested(result: Readonly<MutantResult>): void {
    if (!this.state) {
      return;
    }
    this.state = recordMutantTested(this.state, result.status);
    this.flush(this.state, 'running');
  }

  public onMutationTestReportReady(): void {
    if (!this.state) {
      return;
    }
    this.flush(this.state, 'done');
  }

  // Takes the already-narrowed state as an explicit parameter rather than
  // re-reading (and re-guarding) `this.state` - every call site above has
  // already established it's set, so a third redundant guard here would be
  // an untestable dead branch (only type-narrowing, never a real runtime
  // path).
  private flush(state: MutationProgressState, status: 'running' | 'done'): void {
    this.write(this.filePath, buildProgressRecord(state, this.now(), { file: this.mutateFile, status }));
  }
}
