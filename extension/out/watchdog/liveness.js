"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLiveness = computeLiveness;
function computeLiveness(hb, nowMs, config, pidAlive) {
    if (!hb)
        return { state: 'unknown', label: 'waiting for heartbeat' };
    if (!pidAlive)
        return { state: 'dead', label: 'not responding' };
    const beatMs = new Date(hb.last_beat).getTime();
    if (isNaN(beatMs))
        return { state: 'unknown', label: 'malformed heartbeat timestamp' };
    const ageSeconds = (nowMs - beatMs) / 1000;
    if (hb.in_flight) {
        if (ageSeconds > config.inFlightTimeoutSeconds) {
            return { state: 'stuck', label: `stuck: ${hb.last_tool}` };
        }
        return { state: 'alive' };
    }
    if (ageSeconds > config.deadTimeoutSeconds)
        return { state: 'dead', label: 'not responding' };
    if (ageSeconds > config.staleTimeoutSeconds)
        return { state: 'idle', label: 'idle' };
    return { state: 'alive' };
}
//# sourceMappingURL=liveness.js.map