"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEmailSubject = buildEmailSubject;
exports.buildEmailBody = buildEmailBody;
function buildEmailSubject(role) {
    return `SwarmForge: ${role} needs you`;
}
function buildEmailBody(params) {
    const lines = [`${params.role} is waiting on a response.`];
    if (params.ticketBadge) {
        lines.push(`Ticket: ${params.ticketBadge.id} — ${params.ticketBadge.summary}`);
    }
    if (params.snippet) {
        lines.push(`Prompt: ${params.snippet}`);
    }
    if (params.sessionUrl) {
        lines.push(`Open: ${params.sessionUrl}`);
    }
    else {
        lines.push('No session link captured — answer in the tile.');
    }
    return lines.join('\n');
}
//# sourceMappingURL=emailContent.js.map