// BL-340's own notes name the known limit explicitly: aider is a file
// editor with no autonomous shell execution (see
// swarmforge/constitution/articles/engineering.prompt's aider+Mistral entry
// and agent_runtime_lib.bb's :wake-style :shell-run-script special-casing
// of aider). A role driven through it SIMULATES rather than acts, so a
// benchmark trial against it would not be measuring the same thing every
// other provider is measured on. This is checked structurally, before any
// trial runs, rather than by attempting a live run and hoping it fails
// loudly - acceptance scenario 08 ("not ranked as though it completed the
// task") depends on the exclusion being decided up front.
const PROVIDERS_THAT_CANNOT_ACT_AUTONOMOUSLY = new Set(['aider']);

export function canActAutonomously(provider: string): boolean {
  return !PROVIDERS_THAT_CANNOT_ACT_AUTONOMOUSLY.has(provider);
}

export function autonomyExclusionReason(provider: string): string | null {
  if (canActAutonomously(provider)) {
    return null;
  }
  return `${provider} cannot execute shell actions autonomously, so it cannot perform the coder role's task`;
}
