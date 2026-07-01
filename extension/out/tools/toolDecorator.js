"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withHeartbeat = withHeartbeat;
exports.resetBeatCount = resetBeatCount;
const heartbeat_1 = require("./heartbeat");
const beatCounts = new Map();
function withHeartbeat(heartbeatDir, role, pid, toolName, fn) {
    const prev = beatCounts.get(role) ?? 0;
    const count = prev + 1;
    beatCounts.set(role, count);
    const timestamp = new Date().toISOString();
    const writeState = (phase, in_flight) => {
        const data = { role, pid, last_beat: timestamp, last_tool: toolName, phase, in_flight, beat_count: count };
        (0, heartbeat_1.writeHeartbeat)(heartbeatDir, data);
    };
    writeState('entry', true);
    let result;
    try {
        result = fn();
    }
    catch (err) {
        writeState('exit', false);
        throw err;
    }
    if (result instanceof Promise) {
        return result.then((v) => { writeState('exit', false); return v; }, (err) => { writeState('exit', false); throw err; });
    }
    writeState('exit', false);
    return result;
}
function resetBeatCount(role) {
    if (role !== undefined) {
        beatCounts.delete(role);
    }
    else {
        beatCounts.clear();
    }
}
//# sourceMappingURL=toolDecorator.js.map