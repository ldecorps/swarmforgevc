"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLatestSessionUrl = extractLatestSessionUrl;
exports.recordSessionUrl = recordSessionUrl;
exports.getSessionUrl = getSessionUrl;
exports.resetSessionUrls = resetSessionUrls;
// Captures claude.ai/code/session_... deep links as they stream through an
// agent's pane so BL-073's email notifier can link the human straight into
// that agent's remote session. The claude CLI prints the URL once at session
// start and it can scroll out of view (see BL-070), so the latest URL seen
// for a role is remembered here rather than re-derived per email.
const SESSION_URL_PATTERN = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/g;
const latestByRole = new Map();
// Text is the FULL current pane content, so later prints appear later in the
// string; the last match is always the freshest URL currently in view.
function extractLatestSessionUrl(text) {
    if (!text)
        return null;
    const matches = text.match(SESSION_URL_PATTERN);
    if (!matches || matches.length === 0)
        return null;
    return matches[matches.length - 1];
}
function recordSessionUrl(role, paneText) {
    const url = extractLatestSessionUrl(paneText);
    if (url) {
        latestByRole.set(role, url);
    }
}
function getSessionUrl(role) {
    return latestByRole.get(role) ?? null;
}
function resetSessionUrls() {
    latestByRole.clear();
}
//# sourceMappingURL=sessionUrlCapture.js.map