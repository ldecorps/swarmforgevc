/**
 * BL-1015 D2 (architect send-back #1): the state machine itself, split out of
 * the top-level `boyScoutRun.ts` barrel so the barrel and `./cli` can both
 * import it without importing EACH OTHER. `cli.ts` used to import
 * `boyScoutRun` from `../boyScoutRun` (the barrel), and the barrel dynamically
 * `require`s `./cli` for its own `require.main === module` entry point -
 * dependency-cruiser's acyclic rule counts a resolved `require()` the same as
 * a static import, so that pair was a real two-node cycle, not merely a
 * static-analysis artifact. Both sides now depend inward on this module
 * instead.
 *
 * The order of the checks in `boyScoutRun` is load-bearing, not stylistic:
 * everything that can refuse happens before the first write, so a refused or
 * abandoned cleanup leaves the working tree exactly as it found it
 * (invariant 1, "never partially applied").
 */

import { normalizeSubject } from '../boyScoutScan';

import { assertionsWouldChange } from './assertionGuard';
import { buildCommitMessage } from './commit';
import { defaultEnvironment } from './environment';
import { exceedsEnvelope, measureProposal, normalizeEdits } from './measure';
import { SIZE_ENVELOPE } from './types';
import type { CurrentContent, GateResult, RunEnvironment, RunResult } from './types';

function blank(ranked: number): RunResult {
  return {
    outcome: 'nothing-to-do',
    reason: null,
    subject: null,
    summary: null,
    measured: { files: 0, lines: 0 },
    envelope: { ...SIZE_ENVELOPE },
    exceeded: [],
    editedPaths: [],
    committed: false,
    gate: null,
    ranked,
    detail: null,
  };
}

export function boyScoutRun(root: string, overrides: Partial<RunEnvironment> = {}): RunResult {
  const env: RunEnvironment = { ...defaultEnvironment, ...overrides };

  const { ranked } = env.scanRepository(root);
  if (ranked.length === 0) {
    return { ...blank(0), reason: 'nothing-ranked' };
  }

  const top = ranked[0];
  const base = { ...blank(ranked.length), subject: top.subject };
  const proposal = env.propose(top, root, env.readFile);
  if (!proposal || proposal.edits.length === 0) {
    return { ...base, reason: 'no-cleanup-proposed' };
  }

  const edits = normalizeEdits(proposal.edits);
  const withProposal = { ...base, summary: proposal.summary, editedPaths: edits.map((e) => e.path) };

  // Invariant 1, "at most ONE item": the run never touches anything other than
  // the top-ranked one, and a proposal that names something else is refused
  // rather than quietly re-pointed at the right item.
  if (normalizeSubject(proposal.subject) !== normalizeSubject(top.subject)) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal is for ${proposal.subject}, not the top-ranked ${top.subject}`,
    };
  }
  const others = new Set(ranked.slice(1).map((entry) => normalizeSubject(entry.subject)));
  const trespass = edits.filter((edit) => others.has(normalizeSubject(edit.path)));
  if (trespass.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal would also edit other ranked item(s): ${trespass.map((e) => e.path).join(', ')}`,
    };
  }

  const currentOf: CurrentContent = (relPath) => env.readFile(root, relPath);
  const measured = measureProposal(edits, currentOf);
  if (measured.files === 0) {
    // Applying, gating and committing an empty diff would report "cleaned"
    // for a run that changed nothing — invariant 3's exact ambiguity.
    return { ...withProposal, reason: 'no-cleanup-proposed', detail: 'the proposal changes nothing' };
  }

  const exceeded = exceedsEnvelope(measured, SIZE_ENVELOPE);
  if (exceeded.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'envelope-exceeded',
      measured,
      exceeded,
      detail: `the cleanup would change ${measured.files} file(s) and ${measured.lines} line(s)`,
    };
  }

  const offending = assertionsWouldChange(edits, currentOf);
  if (offending) {
    return {
      ...withProposal,
      outcome: 'abandoned',
      reason: 'assertion-would-change',
      measured,
      detail: offending.path,
    };
  }

  // From here on the tree is written to, so every exit restores it first.
  const snapshot = new Map<string, string | null>(edits.map((edit) => [edit.path, currentOf(edit.path)]));
  const restore = () => {
    for (const [relPath, content] of snapshot) env.writeFile(root, relPath, content);
  };

  let gate: GateResult;
  try {
    for (const edit of edits) env.writeFile(root, edit.path, edit.after);
    gate = env.runGates(root);
  } catch (err) {
    restore();
    throw err;
  }

  if (!gate.passed) {
    restore();
    return { ...withProposal, outcome: 'abandoned', reason: 'gate-failed', measured, gate };
  }

  const cleaned: RunResult = { ...withProposal, outcome: 'cleaned', reason: null, measured, gate };
  try {
    env.commit(root, buildCommitMessage(cleaned), cleaned.editedPaths);
  } catch (err) {
    restore();
    throw err;
  }
  return { ...cleaned, committed: true };
}
