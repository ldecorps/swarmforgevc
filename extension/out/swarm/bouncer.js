"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBounceExtensionCommand = buildBounceExtensionCommand;
exports.bounceSwarm = bounceSwarm;
const swarmStopper_1 = require("./swarmStopper");
const swarmLauncher_1 = require("./swarmLauncher");
function buildBounceExtensionCommand() {
    return 'workbench.action.reloadWindow';
}
async function bounceSwarm(targetPath, runName, stopFn, launchFn) {
    const stop = stopFn || swarmStopper_1.stopSwarm;
    const launch = launchFn || swarmLauncher_1.launchSwarm;
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
//# sourceMappingURL=bouncer.js.map