import * as vscode from 'vscode';

// Per the constitution's secrets rule: RESEND_API_KEY is never a workspace
// setting (settings.json can be committed) — it comes only from the
// extension host's own environment or VS Code SecretStorage, both of which
// stay outside the target repo.
export const RESEND_SECRET_KEY = 'swarmforge.resendApiKey';

export async function resolveResendApiKey(
  secrets?: vscode.SecretStorage
): Promise<string | undefined> {
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) {
    return envKey;
  }
  if (secrets) {
    return await secrets.get(RESEND_SECRET_KEY);
  }
  return undefined;
}
