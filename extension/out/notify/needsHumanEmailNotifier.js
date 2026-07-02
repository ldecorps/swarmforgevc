"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeedsHumanEmailNotifier = void 0;
exports.decideNotifyAction = decideNotifyAction;
const emailContent_1 = require("./emailContent");
function decideNotifyAction(needsHumanSinceMs, lastEmailSentMs, nowMs, config) {
    if (needsHumanSinceMs === null) {
        return 'skip';
    }
    const graceElapsedSeconds = (nowMs - needsHumanSinceMs) / 1000;
    if (graceElapsedSeconds < config.graceSeconds) {
        return 'wait';
    }
    if (lastEmailSentMs !== null) {
        const cooldownElapsedSeconds = (nowMs - lastEmailSentMs) / 1000;
        if (cooldownElapsedSeconds < config.cooldownSeconds) {
            return 'cooldown';
        }
    }
    return 'send';
}
class NeedsHumanEmailNotifier {
    config;
    adapters;
    since = new Map();
    lastSent = new Map();
    snippet = new Map();
    constructor(config, adapters) {
        this.config = config;
        this.adapters = adapters;
    }
    // Edge-triggered updates from the existing needs-human detector (BL-045):
    // a role entering needs-human starts its grace clock; leaving it (answered)
    // before the sweep fires cancels the pending email outright.
    recordUpdates(updates, nowMs) {
        for (const update of updates) {
            if (update.needsHuman) {
                if (!this.since.has(update.role)) {
                    this.since.set(update.role, nowMs);
                }
                if (update.snippet) {
                    this.snippet.set(update.role, update.snippet);
                }
            }
            else {
                this.since.delete(update.role);
            }
        }
    }
    sweep(nowMs) {
        if (!this.config.enabled) {
            return;
        }
        for (const [role, sinceMs] of this.since.entries()) {
            const lastSentMs = this.lastSent.get(role) ?? null;
            const action = decideNotifyAction(sinceMs, lastSentMs, nowMs, this.config);
            if (action !== 'send') {
                continue;
            }
            // Record the cooldown before the request settles: a failed or slow
            // Resend call must never turn into a retry storm (BL-073 failure
            // tolerance).
            this.lastSent.set(role, nowMs);
            const message = {
                to: this.config.to,
                from: this.config.from,
                subject: (0, emailContent_1.buildEmailSubject)(role),
                text: (0, emailContent_1.buildEmailBody)({
                    role,
                    snippet: this.snippet.get(role) ?? '',
                    sessionUrl: this.adapters.getSessionUrl(role),
                    ticketBadge: this.adapters.getTicketBadge(role),
                }),
            };
            this.adapters
                .sendEmail(message)
                .then((result) => this.adapters.onSendResult?.(role, result))
                .catch((err) => {
                const detail = err instanceof Error ? err.message : 'unknown error';
                this.adapters.onSendResult?.(role, { success: false, error: detail });
            });
        }
    }
}
exports.NeedsHumanEmailNotifier = NeedsHumanEmailNotifier;
//# sourceMappingURL=needsHumanEmailNotifier.js.map