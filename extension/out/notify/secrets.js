"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESEND_SECRET_KEY = void 0;
exports.resolveResendApiKey = resolveResendApiKey;
// Per the constitution's secrets rule: RESEND_API_KEY is never a workspace
// setting (settings.json can be committed) — it comes only from the
// extension host's own environment or VS Code SecretStorage, both of which
// stay outside the target repo.
exports.RESEND_SECRET_KEY = 'swarmforge.resendApiKey';
async function resolveResendApiKey(secrets) {
    const envKey = process.env.RESEND_API_KEY;
    if (envKey) {
        return envKey;
    }
    if (secrets) {
        return await secrets.get(exports.RESEND_SECRET_KEY);
    }
    return undefined;
}
//# sourceMappingURL=secrets.js.map