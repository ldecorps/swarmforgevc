"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESEND_SECRET_KEY = void 0;
exports.resolveResendApiKey = resolveResendApiKey;
exports.trimmedResendKeyInput = trimmedResendKeyInput;
exports.describeSetResult = describeSetResult;
exports.describeClearResult = describeClearResult;
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
// BL-103: pure helpers behind the Set/Clear Resend API Key commands. The
// input box itself is the untestable VS Code UI boundary; everything with
// actual logic - trimming/empty-input handling and the resolution-order
// message - is factored out here so it is unit-testable without vscode.
/** Empty or whitespace-only input is a safe no-op: undefined, never "". */
function trimmedResendKeyInput(input) {
    const trimmed = input?.trim();
    return trimmed ? trimmed : undefined;
}
function precedenceNote(envVarSet) {
    return envVarSet
        ? ' Note: the RESEND_API_KEY environment variable is currently set and takes precedence over this value until it is unset.'
        : '';
}
function describeSetResult(envVarSet) {
    return `Resend API key stored in SecretStorage.${precedenceNote(envVarSet)}`;
}
function describeClearResult(envVarSet) {
    return `Resend API key cleared from SecretStorage.${precedenceNote(envVarSet)}`;
}
//# sourceMappingURL=secrets.js.map