"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MISTRAL_SECRET_KEY = exports.OPENAI_SECRET_KEY = exports.RESEND_SECRET_KEY = void 0;
exports.resolveResendApiKey = resolveResendApiKey;
exports.trimmedResendKeyInput = trimmedResendKeyInput;
exports.describeSetResult = describeSetResult;
exports.describeClearResult = describeClearResult;
exports.resolveOpenAIApiKey = resolveOpenAIApiKey;
exports.resolveMistralApiKey = resolveMistralApiKey;
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
// BL-130: per-role alternate agent runtime (e.g. aider on Mistral/OpenAI for
// an offloaded role). Same secrets rule as Resend above: these must resolve
// only from the host env var or SecretStorage, never a workspace setting,
// dotfile, launch script default, or the repo.
exports.OPENAI_SECRET_KEY = 'swarmforge.openaiApiKey';
exports.MISTRAL_SECRET_KEY = 'swarmforge.mistralApiKey';
async function resolveOpenAIApiKey(secrets) {
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
        return envKey;
    }
    if (secrets) {
        return await secrets.get(exports.OPENAI_SECRET_KEY);
    }
    return undefined;
}
async function resolveMistralApiKey(secrets) {
    const envKey = process.env.MISTRAL_API_KEY;
    if (envKey) {
        return envKey;
    }
    if (secrets) {
        return await secrets.get(exports.MISTRAL_SECRET_KEY);
    }
    return undefined;
}
//# sourceMappingURL=secrets.js.map