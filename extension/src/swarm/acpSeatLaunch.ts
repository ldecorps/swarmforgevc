// BL-1081 (QA bounce D1): the launch decision for the spiked ACP seat.
//
// The first parcel built the host, the snapshot, and the babysitter read
// path — and nothing in production ever spawned the host (BL-149). This
// module is the pure decision write_role_launch_script consults (via the
// compiled CLI it names) so a vibe seat's pane process IS the host.
//
// Exactly ONE seat is hosted in this spike (Mistral Vibe). Other agents
// marked `:acp true` on the provider table stay pane-driven until a later
// ticket widens the spike. That distinction is deliberate: acp-native? is
// "can be hosted"; shouldLaunchViaAcpHost is "is hosted now".

/** The agent token this spike puts behind the ACP host. Mirrors
 *  `prompt_engine_lib.bb`'s `acp-spike-seat-agent` — kept in agreement by
 *  `bl1081_acp_snapshot_agreement_test_runner.bb`. */
export const ACP_SPIKE_SEAT_AGENT = 'vibe';

/** Relative path of the compiled pane-host CLI from the repo root. */
export const ACP_HOST_PANE_REL = 'extension/out/tools/acp-host-pane.js';

export function normalizeAgentToken(agent: string): string {
  return String(agent || '').trim().toLowerCase();
}

/**
 * True only for the single seat the production launcher must put behind
 * the ACP host. Never inferred from pane text; never true for "every
 * acp-native agent".
 */
export function shouldLaunchViaAcpHost(agent: string): boolean {
  return normalizeAgentToken(agent) === ACP_SPIKE_SEAT_AGENT;
}

export interface AcpHostPaneLaunchParts {
  /** Absolute or repo-relative path to the compiled acp-host-pane.js. */
  hostEntry: string;
  role: string;
  agent: string;
  worktree: string;
  promptFile: string;
  /** Extra CLI args for the underlying agent (may be empty). */
  extraCli?: string;
  /** Optional add-dir for the master checkout when the seat has its own worktree. */
  addDir?: string;
}

/**
 * Build the shell command that becomes a role's pane process when the seat
 * is ACP-hosted. The host is `node <hostEntry> …`; the agent CLI is a
 * subprocess the host owns — never the pane's direct command.
 */
export function buildAcpHostPaneCommand(parts: AcpHostPaneLaunchParts): string {
  if (!shouldLaunchViaAcpHost(parts.agent)) {
    throw new Error(
      `buildAcpHostPaneCommand refused agent "${parts.agent}" — only the spike seat (${ACP_SPIKE_SEAT_AGENT}) launches via the ACP host`
    );
  }
  const args = [
    'node',
    shellSingleQuote(parts.hostEntry),
    '--role',
    shellSingleQuote(parts.role),
    '--agent',
    shellSingleQuote(normalizeAgentToken(parts.agent)),
    '--workdir',
    shellSingleQuote(parts.worktree),
    '--prompt-file',
    shellSingleQuote(parts.promptFile),
  ];
  if (parts.addDir) {
    args.push('--add-dir', shellSingleQuote(parts.addDir));
  }
  if (parts.extraCli && parts.extraCli.trim()) {
    args.push('--extra-cli', shellSingleQuote(parts.extraCli.trim()));
  }
  // RESUME_NOTE is expanded by the launch script preamble (BL-323), then
  // the prompt file is cat'd — same first-message shape the direct vibe
  // launch used, so the hosted seat still receives its constitution.
  args.push('"${RESUME_NOTE}$(cat \'' + parts.promptFile.replace(/'/g, `'\\''`) + '\')"');
  return args.join(' ');
}

function shellSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
