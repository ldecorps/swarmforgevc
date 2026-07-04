"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBounceExtensionCommand = buildBounceExtensionCommand;
exports.bounceSwarm = bounceSwarm;
const swarmStopper_1 = require("./swarmStopper");
const swarmLauncher_1 = require("./swarmLauncher");
function buildBounceExtensionCommand() {
    return 'workbench.action.reloadWindow';
}
/**
 * Bounce = stop + launch. The stop phase is advisory: a swarm that is already
 * dead or half-dead must not prevent the relaunch (that is precisely when a
 * bounce is most needed). The bounce fails only if the launch fails.
 */
async function bounceSwarm(targetPath, runName, stopFn, launchFn) {
    const stop = stopFn || swarmStopper_1.stopSwarm;
    const launch = launchFn || swarmLauncher_1.launchSwarm;
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
//# sourceMappingURL=bouncer.js.map