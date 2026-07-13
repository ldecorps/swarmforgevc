#!/usr/bin/env node
/**
 * BL-352 (BL-336 finding H5): records a shell-launched swarm run into the
 * SAME runs.jsonl runLog.ts's appendRun/updateLastRunForTarget already
 * define - only the VS Code launchSwarm/stopSwarm/openPR/setRunMode
 * commands wrote to it before this, so a swarm launched via ./swarm (which
 * is how the real swarm actually runs, including this box's own) never
 * appeared in the run history the bridge's /runlog surface reads.
 *
 * Usage:
 *   node record-run.js start <target-path>
 *   node record-run.js stop <target-path>
 *
 * swarmforge.sh's own launch path shells to `start`; kill_all_swarm.sh's
 * own stop path shells to `stop`. Neither is invoked when the SAME launch
 * is initiated via the VS Code launchSwarm command (which already calls
 * appendRun itself and sets SWARMFORGE_SKIP_SHELL_RUN_RECORD=1 on the
 * env it launches ./swarm with) - see swarmOrchestrator.ts's own
 * startSwarmAgents. This is what keeps a launch recorded exactly once
 * regardless of which door it came in.
 */
import * as os from 'os';
import * as path from 'path';
import { appendRun, updateLastRunForTarget } from '../runs/runLog';
import { generateDefaultRunName } from '../run/resolveRunName';
import { runCliMain, printJsonToStdout } from './swarm-metrics';

function runLogPath(): string {
  return path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
}

export function parseCliArgs(argv: string[]): { mode: 'start' | 'stop'; targetPath: string } | null {
  const [mode, targetPath] = argv;
  if (mode !== 'start' && mode !== 'stop') {
    return null;
  }
  if (!targetPath) {
    return null;
  }
  return { mode, targetPath };
}

export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write('Usage: record-run.js <start|stop> <target-path>\n');
    process.exitCode = 1;
    return;
  }

  if (args.mode === 'start') {
    const name = generateDefaultRunName();
    appendRun(runLogPath(), { name, targetPath: args.targetPath, startedAt: new Date().toISOString(), status: 'running' });
    printJsonToStdout({ recorded: 'start', name });
    return;
  }

  updateLastRunForTarget(runLogPath(), args.targetPath, { completedAt: new Date().toISOString(), status: 'stopped' });
  printJsonToStdout({ recorded: 'stop' });
}

if (require.main === module) {
  runCliMain(main);
}
