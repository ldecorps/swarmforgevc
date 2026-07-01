"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logHumanInput = logHumanInput;
exports.isHumanInputMessage = isHumanInputMessage;
const messageBus_1 = require("./messageBus");
/**
 * Log a human instruction directed at role into the message store.
 * Returns the message id.
 */
function logHumanInput(dir, role, text, seq) {
    return (0, messageBus_1.createMessage)(dir, {
        from: 'human',
        to: role,
        subject: 'human-input',
        body: text,
        seq,
    });
}
/**
 * Returns true if the first event in logPath is a human-input message.
 * The chase monitor uses this to skip human-input messages.
 */
function isHumanInputMessage(logPath) {
    const events = (0, messageBus_1.readLog)(logPath);
    if (events.length === 0)
        return false;
    const first = events[0];
    return first.from === 'human' && first.subject === 'human-input';
}
//# sourceMappingURL=humanInput.js.map