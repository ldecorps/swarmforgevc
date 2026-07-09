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

export class MutationProgressReporter implements Reporter {
  private state: MutationProgressState | undefined;
  private readonly now: () => number;
  private readonly filePath: string;
  private readonly write: (filePath: string, record: ReturnType<typeof buildProgressRecord>) => void;
  private readonly mutateFile: string | undefined;

  constructor(deps: MutationProgressReporterDeps = {}) {
    this.now = deps.now ?? Date.now;
    const role = deps.role ?? process.env.SWARMFORGE_ROLE ?? 'unknown';
    // Compiled to out/mutation/mutationProgressReporter.js: out -> extension -> repo root.
    const repoRoot = path.join(__dirname, '..', '..', '..');
    this.filePath = deps.filePath ?? defaultProgressFilePath(repoRoot, role);
    this.write = deps.write ?? writeProgressRecord;
    this.mutateFile = deps.mutateFile ?? process.env.STRYKER_MUTATE_FILE;
  }

  public onMutationTestingPlanReady(event: MutationTestingPlanReadyEvent): void {
    const total = event.mutantPlans.filter((plan) => plan.plan === RUN_PLAN).length;
    this.state = initMutationProgressState(total, this.now());
    this.flush('running');
  }

  public onMutantTested(result: Readonly<MutantResult>): void {
    if (!this.state) {
      return;
    }
    this.state = recordMutantTested(this.state, result.status);
    this.flush('running');
  }

  public onMutationTestReportReady(): void {
    if (!this.state) {
      return;
    }
    this.flush('done');
  }

  private flush(status: 'running' | 'done'): void {
    if (!this.state) {
      return;
    }
    this.write(this.filePath, buildProgressRecord(this.state, this.now(), { file: this.mutateFile, status }));
  }
}
