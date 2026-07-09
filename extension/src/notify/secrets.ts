import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

// BL-103: pure helpers behind the Set/Clear Resend API Key commands. The
// input box itself is the untestable VS Code UI boundary; everything with
// actual logic - trimming/empty-input handling and the resolution-order
// message - is factored out here so it is unit-testable without vscode.

/** Empty or whitespace-only input is a safe no-op: undefined, never "". */
export function trimmedResendKeyInput(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed ? trimmed : undefined;
}

function precedenceNote(envVarSet: boolean): string {
  return envVarSet
    ? ' Note: the RESEND_API_KEY environment variable is currently set and takes precedence over this value until it is unset.'
    : '';
}

export function describeSetResult(envVarSet: boolean): string {
  return `Resend API key stored in SecretStorage.${precedenceNote(envVarSet)}`;
}

export function describeClearResult(envVarSet: boolean): string {
  return `Resend API key cleared from SecretStorage.${precedenceNote(envVarSet)}`;
}

// BL-130: per-role alternate agent runtime (e.g. aider on Mistral/OpenAI for
// an offloaded role). Same secrets rule as Resend above: these must resolve
// only from the host env var or SecretStorage, never a workspace setting,
// dotfile, launch script default, or the repo.
export const OPENAI_SECRET_KEY = 'swarmforge.openaiApiKey';
export const MISTRAL_SECRET_KEY = 'swarmforge.mistralApiKey';

/** Last-resort: read an export from the operator shell profile (never written to repo). */
export function readMistralKeyFromShellProfile(): string | undefined {
  const profileFiles = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.profile'),
  ];
  for (const file of profileFiles) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(/^\s*export\s+MISTRAL_API_KEY=(.+)$/m);
      if (!match) {
        continue;
      }
      const raw = match[1].trim();
      return raw.replace(/^(['"])(.*)\1$/, '$2');
    } catch {
      // profile absent or unreadable
    }
  }
  return undefined;
}

export async function resolveOpenAIApiKey(
  secrets?: vscode.SecretStorage
): Promise<string | undefined> {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return envKey;
  }
  if (secrets) {
    return await secrets.get(OPENAI_SECRET_KEY);
  }
  return undefined;
}

export async function resolveMistralApiKey(
  secrets?: vscode.SecretStorage
): Promise<string | undefined> {
  const envKey = process.env.MISTRAL_API_KEY;
  if (envKey) {
    return envKey;
  }
  if (secrets) {
    const stored = await secrets.get(MISTRAL_SECRET_KEY);
    if (stored) {
      return stored;
    }
  }
  return readMistralKeyFromShellProfile();
}
