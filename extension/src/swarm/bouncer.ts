import { StopResult, stopSwarm } from './swarmStopper';
import { LaunchResult, launchSwarm } from './swarmLauncher';

export interface BounceResult {
  success: boolean;
  message: string;
  targetPath: string;
}

export function buildBounceExtensionCommand(): string {
  return 'workbench.action.reloadWindow';
}

export async function bounceSwarm(
  targetPath: string,
  runName: string,
  stopFn?: (target: string) => StopResult,
  launchFn?: (target: string, name: string) => Promise<LaunchResult>,
): Promise<BounceResult> {
  const stop = stopFn || stopSwarm;
  const launch = launchFn || launchSwarm;

  const stopResult = stop(targetPath);
  if (!stopResult.success) {
    return {
      success: false,
      message: `Failed to stop swarm: ${stopResult.message}`,
      targetPath,
    };
  }

  const launchResult = await launch(targetPath, runName);
  if (!launchResult.success) {
    return {
      success: false,
      message: `Failed to launch swarm: ${launchResult.message}`,
      targetPath,
    };
  }

  return {
    success: true,
    message: `${stopResult.message}; ${launchResult.message}`,
    targetPath,
  };
}
