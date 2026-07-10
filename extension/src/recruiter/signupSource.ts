// BL-233 QA bounce follow-up (ddc0d351ed): the CLI orchestrator needs SOME
// production SignupSource. Mirrors discoverySource.ts's own established
// choice: rather than build fragile, provider-specific web-automation
// (impossible to make safely bounded/testable across arbitrary providers -
// see acquire.ts's own "never attempt to defeat anti-automation controls"
// posture), this resolves each automatable candidate's key from an
// operator-maintained JSON map (model -> apiKey), populated by whatever
// mechanism actually obtained it (manual signup today; a future provider-
// specific automation could fill the same seam later without touching
// acquire.ts/orchestrator.ts). Never called for wall candidates -
// acquireAccess() only invokes signUp() for 'automatable' candidates.

import * as fs from 'fs';
import { ModelCandidate, SignupSource } from './candidate';

export function createFileSignupSource(keysFilePath: string): SignupSource {
  return {
    async signUp(candidate: ModelCandidate): Promise<string> {
      if (!fs.existsSync(keysFilePath)) {
        throw new Error(
          `no signup keys file found at ${keysFilePath} - obtain "${candidate.model}"'s key first (e.g. manual signup) and record it there`
        );
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(keysFilePath, 'utf-8'));
      const key = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[candidate.model] : undefined;
      if (typeof key !== 'string' || !key) {
        throw new Error(`no API key recorded for candidate "${candidate.model}" in ${keysFilePath}`);
      }
      return key;
    },
  };
}
