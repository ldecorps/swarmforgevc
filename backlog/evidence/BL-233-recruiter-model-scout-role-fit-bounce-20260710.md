# BL-233 slice 2 bounce evidence (cleaner, 2026-07-10)

1. **Failing command**: `npm run compile` (equivalently `npx tsc -p ./ --noEmit`), run from `extension/`.

2. **Commit hash**: `4268950bac` (coder's "BL-233 slice 2: recruiter auto-acquires access, escalates walls to a human"), merged into the cleaner branch at `ec1d06d`.

3. **First error excerpt**:
   ```
   > swarmforge-vc@0.1.0 compile
   > tsc -p ./

   src/recruiter/acquire.ts(12,10): error TS2305: Module '"./candidate"' has no exported member 'AcquireOutcome'.
   src/recruiter/acquire.ts(12,42): error TS2305: Module '"./candidate"' has no exported member 'SecretStore'.
   src/recruiter/acquire.ts(12,55): error TS2305: Module '"./candidate"' has no exported member 'SignupSource'.
   src/recruiter/secretStore.ts(12,26): error TS2305: Module '"./candidate"' has no exported member 'SecretStore'.
   ```

4. **Failure class**: `compile`.

5. **Expected vs observed**: the commit message states "candidate.ts: adds the shared AcquireOutcome/SignupSource/SecretStore shapes slice 2+ needs" — expected `extension/src/recruiter/candidate.ts` to export `AcquireOutcome`, `SignupSource`, and `SecretStore` alongside the existing `ModelCandidate`/`SignupPath`/`PlanCost` shapes. Observed: `git diff 4268950bac^ 4268950bac -- extension/src/recruiter/candidate.ts` is empty — the file was never actually touched by this commit, so `acquire.ts` and `secretStore.ts` import three type names that don't exist. `npm test` never reaches the new recruiter tests because `npm run compile` (which `npm test` runs first) fails before any test executes.

Shapes are otherwise unambiguous from the consuming code and the already-written tests (`extension/test/recruiterAcquire.test.js`, `extension/test/recruiterSecretStore.test.js`):
- `SignupSource`: `{ signUp(candidate: ModelCandidate): Promise<string> }`
- `SecretStore`: `{ store(candidate: ModelCandidate, apiKey: string): Promise<void> }`
- `AcquireOutcome`: a discriminated union — `{ model: string; status: 'acquired' } | { model: string; status: 'escalated'; wall: SignupAutomation }`

Left for the coder to add: defining new exported types is design/implementation, not cleanup — the cleaner's role does not own introducing new behavior or new module surface.
