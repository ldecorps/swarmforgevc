// BL-1081: the thin ACP host that lives in the role's own tmux pane.
//
// It hosts the agent CLI as an ACP subprocess over stdio, renders the
// transcript into the pane so a human and the babysitter both still see one,
// and writes the structured seat snapshot where the deterministic layer can
// read it.
//
// The pane is NOT replaced. That is the middle path this ticket takes: a
// machine-only pane would pass every structured check and fail invariant 2,
// and would cost the observability the whole swarm is watched through.
//
// Side effects are injected (writeLine, writeSnapshot), so the pumping logic
// is testable without a process, a pane, or a filesystem - the same seam
// shape cursorSeatDriver.ts already uses.

import { parseAcpLine } from './acpSessionEvents';
import type { AcpEvent } from './acpSessionTypes';
import type { AcpSeatSnapshot, AcpSeatState } from './acpSeatState';
import { EMPTY_SEAT_STATE, applyAcpEvent, snapshotForSeat } from './acpSeatState';

export interface AcpHostDeps {
  /** Render one line into the pane. */
  writeLine: (line: string) => void;
  /** Persist the seat snapshot where the bb side reads it. */
  writeSnapshot: (snapshot: AcpSeatSnapshot) => void;
}

export interface AcpHostOptions {
  role: string;
}

/**
 * A tool identifier, as the host's own status lines name it.
 *
 * ACP lets a CLI supply a tool `title` that is prose rather than a name, and
 * that prose is external text landing on a surface other things read: the
 * babysitter's interactive-menu CRIT is a pattern match against pane text, and
 * a title like "Do you want to write this file" reproduces exactly the shape
 * it blocks on. A seat that is structurally unblocked would then be reported
 * menu-blocked by its own status line.
 *
 * Collapsing to a single bounded token is deliberately independent of what
 * that pattern happens to contain: the CRIT's vocabulary is multi-word English
 * phrases and terminal punctuation, and neither survives a name with no spaces
 * and no punctuation. Mirroring the pattern itself would be a constant copied
 * across a boundary no import bridges, which drifts silently (BL-897).
 *
 * The agent's own prose is NOT scrubbed - it arrives as a transcript event and
 * reaches the pane verbatim, because a readable transcript is the point.
 */
export function paneToolLabel(tool: string): string {
  const token = tool.trim().replace(/[^A-Za-z0-9_./-]+/g, '_').replace(/^_+|_+$/g, '');
  const named = token || 'unnamed_tool';
  return named.length > 48 ? `${named.slice(0, 48)}…` : named;
}

/**
 * How a fact is shown to a human. Output only - never parsed back to decide
 * anything, which is the rule that keeps the pane a view rather than a channel.
 *
 * Two kinds of line come out of here, and the difference matters: a transcript
 * line is the agent's own words PASSED THROUGH, and the host's other lines are
 * chrome it writes itself. Only the chrome is the host's to keep clean.
 */
export function renderEventForPane(event: AcpEvent): string | null {
  switch (event.kind) {
    case 'transcript':
      return `${event.role === 'agent' ? '' : `[${event.role}] `}${event.text}`;
    case 'tool_status':
      return `[tool] ${paneToolLabel(event.tool)}: ${event.status}`;
    case 'permission_requested':
      return `[permission] ${paneToolLabel(event.tool)} requested (id ${event.requestId})`;
    case 'turn_ended':
      return `[turn ended] ${event.stopReason}`;
  }
}

/**
 * One host session: feed it the agent's stdio lines, it renders and records.
 *
 * The snapshot is rewritten on EVERY fact rather than at the end of a turn.
 * A snapshot written only on completion would be missing exactly when the
 * deterministic layer most needs it - mid-turn, deciding whether this seat is
 * working or stuck.
 */
export class AcpHostSession {
  private state: AcpSeatState = EMPTY_SEAT_STATE;

  constructor(
    private readonly deps: AcpHostDeps,
    private readonly opts: AcpHostOptions
  ) {}

  /** Feed one raw line from the agent. Returns the fact it carried, if any. */
  ingest(line: string): AcpEvent | null {
    const event = parseAcpLine(line);
    if (!event) {
      // Not protocol traffic. It is still the agent talking, so it belongs in
      // the pane - a host that swallowed it would leave a human staring at a
      // blank pane while the CLI printed its startup banner to stderr.
      const text = line.replace(/\s+$/, '');
      if (text) this.deps.writeLine(text);
      return null;
    }
    const rendered = renderEventForPane(event);
    if (rendered !== null) this.deps.writeLine(rendered);
    this.state = applyAcpEvent(this.state, event);
    this.deps.writeSnapshot(this.snapshot());
    return event;
  }

  ingestAll(lines: readonly string[]): void {
    for (const line of lines) this.ingest(line);
  }

  snapshot(): AcpSeatSnapshot {
    return snapshotForSeat(this.opts.role, this.state);
  }

  currentState(): AcpSeatState {
    return this.state;
  }
}

/** Where the deterministic layer looks for a seat's snapshot. */
export function acpSnapshotRelPath(role: string): string {
  return `.swarmforge/acp/${role}.json`;
}
