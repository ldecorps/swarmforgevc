"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateChase = evaluateChase;
exports.appendChaseEvent = appendChaseEvent;
exports.appendDeadLetterEvent = appendDeadLetterEvent;
const messageBus_1 = require("../swarm/messageBus");
function evaluateChase(events, nowMs, config, receiverLiveness, humanInput) {
    if (events.length === 0)
        return 'skipped';
    if (humanInput)
        return 'skipped';
    const last = events[events.length - 1];
    if (last.type === 'done' || last.type === 'dead-letter' || last.type === 'received') {
        return 'already-done';
    }
    if (receiverLiveness === 'dead' || receiverLiveness === 'unknown' || receiverLiveness === 'stuck') {
        return 'skipped';
    }
    const createdEvent = events.find((e) => e.type === 'created');
    if (!createdEvent)
        return 'skipped';
    const chaseEvents = events.filter((e) => e.type === 'chased');
    const chaseCount = chaseEvents.length;
    // Gate on time since last chase (or created if no chases yet)
    const lastChase = chaseEvents[chaseEvents.length - 1];
    const referenceAt = lastChase ? lastChase.at : createdEvent.at;
    const ageSeconds = (nowMs - new Date(referenceAt).getTime()) / 1000;
    if (ageSeconds < config.chaseTimeoutSeconds)
        return 'skipped';
    if (chaseCount >= config.maxChases)
        return 'dead-lettered';
    return 'chased';
}
function appendChaseEventInternal(logPath, type, chaseCount) {
    const event = {
        type,
        chase_count: chaseCount,
        at: new Date().toISOString(),
    };
    if (type === 'chased')
        event.chased_by = 'watchdog';
    (0, messageBus_1.appendEventRaw)(logPath, event);
}
function appendChaseEvent(logPath, chaseCount) {
    appendChaseEventInternal(logPath, 'chased', chaseCount);
}
function appendDeadLetterEvent(logPath, chaseCount) {
    appendChaseEventInternal(logPath, 'dead-letter', chaseCount);
}
//# sourceMappingURL=ChaseMonitor.js.map