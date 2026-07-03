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

/**
 * Bounce = stop + launch. The stop phase is advisory: a swarm that is already
 * dead or half-dead must not prevent the relaunch (that is precisely when a
 * bounce is most needed). The bounce fails only if the launch fails.
 */
export async function bounceSwarm(
  targetPath: string,
  runName: string,
  stopFn?: (target: string) => StopResult,
  launchFn?: (target: string, name: string) => Promise<LaunchResult>,
): Promise<BounceResult> {
  const stop = stopFn || stopSwarm;
  const launch = launchFn || launchSwarm;

  const stopResult = stop(targetPath);
  const stopNote = stopResult.success
    ? stopResult.message
    : `Stop phase reported: ${stopResult.message} — proceeding to launch`;

  const launchResult = await launch(targetPath, runName);
  if (!launchResult.success) {
    return {
      success: false,
      message: `${stopNote}; failed to launch swarm: ${launchResult.message}`,
      targetPath,
    };
  }

  return {
    success: true,
    message: `${stopNote}; ${launchResult.message}`,
    targetPath,
  };
}
