import * as fs from 'fs';
import * as path from 'path';

// BL-066: reinterpreted for the actual built architecture (drives real
// SwarmForge over tmux, per the constitution — not the Specification.MD
// "standalone orchestrator" model this ticket was originally written
// against). tmux sessions already run independent of the extension host —
// there is no child process to detach. The real gap is host-side discovery
// on relaunch: is a swarm already live (re-attach, no restart), or is there
// evidence of a past run with nothing live right now (offer resume instead
// of a silent no-op or a surprise cold start)?

// Written once by the ./swarm launcher on first successful launch for a
// target; its presence means SwarmForge has been run here before, even if
// nothing is live right now.
export function hasPriorRunState(targetPath: string): boolean {
  return fs.existsSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'));
}

// BL-086: startup activation (onStartupFinished) must attach silently or do
// nothing — a "previous run found, resume?" popup on every editor open would
// nag any target with prior run state. The prompt remains available when
// activation was not triggered by startup (e.g. a command wins the
// activation race before onStartupFinished fires), matching pre-BL-086
// behavior on that path.
export function shouldOfferResumePrompt(triggeredByStartup: boolean, hasPriorRun: boolean): boolean {
  return !triggeredByStartup && hasPriorRun;
}
