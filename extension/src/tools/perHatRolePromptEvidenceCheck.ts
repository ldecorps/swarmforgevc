/**
 * BL-758: pure per-hat role-prompt evidence check for /pilot land. Every
 * completed stage verdict under the run's expedite tree must record
 * role_prompt_path + role_prompt_sha256 for the injected live role prompt.
 * IO (reading expedite verdicts) stays in commitClaimGitReader /
 * pilot-acceptance-gate.
 */

export const PILOT_HAT_PROMPT_MISSING_REFUSAL =
  'completed stage verdict missing role_prompt_path or role_prompt_sha256';

export type StageVerdictEvidence = {
  verdictPath: string;
  role?: string;
  role_prompt_path?: string;
  role_prompt_sha256?: string;
};

export type PerHatRolePromptMiss = {
  verdictPath: string;
  role?: string;
};

export type PerHatRolePromptEvidenceOutcome =
  | {
      checked: true;
      verdictsScanned: number;
      miss?: PerHatRolePromptMiss;
    }
  | { checked: false };

export function verdictHasRolePromptEvidence(verdict: StageVerdictEvidence): boolean {
  const pathOk = typeof verdict.role_prompt_path === 'string' && verdict.role_prompt_path.trim().length > 0;
  const hashOk =
    typeof verdict.role_prompt_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(verdict.role_prompt_sha256.trim());
  return pathOk && hashOk;
}

export function assessPerHatRolePromptEvidence(input: {
  verdicts: StageVerdictEvidence[] | undefined;
}): PerHatRolePromptEvidenceOutcome {
  if (input.verdicts === undefined) {
    return { checked: false };
  }
  if (input.verdicts.length === 0) {
    return { checked: true, verdictsScanned: 0 };
  }
  for (const verdict of input.verdicts) {
    if (!verdictHasRolePromptEvidence(verdict)) {
      return {
        checked: true,
        verdictsScanned: input.verdicts.length,
        miss: { verdictPath: verdict.verdictPath, role: verdict.role },
      };
    }
  }
  return { checked: true, verdictsScanned: input.verdicts.length };
}
