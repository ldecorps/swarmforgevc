// BL-1554: the impure IO adapter behind qa-gather.js - the default
// child_process runFn and the ticket-YAML lookup, both of which
// src/quality/qaGather.ts cannot import directly (`.dependency-cruiser.cjs`'s
// no-io-from-policy rule, BL-259 hard gate: src/quality/ is the
// dependency-gate's POLICY zone). Composes the pure checklist/report logic
// (composeQaGatherReport) with real IO, mirroring
// bounceRevertGitAdapter.ts's gatherFacts-then-decide split.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { composeQaGatherReport, QaGatherReport, RunFn, RunOutcome } from '../quality/qaGather';

export function defaultRunFn(command: string, args: string[], cwd: string): RunOutcome {
  const res = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (res.error) {
    return { started: false, exit: null, stdout: '', stderr: '', reason: res.error.message };
  }
  return { started: true, exit: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function readIdField(yamlContent: string): string | undefined {
  for (const line of yamlContent.split('\n')) {
    if (line.startsWith('id:')) {
      return line.slice('id:'.length).trim();
    }
  }
  return undefined;
}

function findYamlInDir(dir: string, ticketId: string): string | undefined {
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findYamlInDir(full, ticketId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (!entry.name.endsWith('.yaml')) {
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    if (readIdField(content) === ticketId) {
      return content;
    }
  }
  return undefined;
}

// Searches active/paused/done (nested by milestone) for ticketId's own
// YAML, matched by its id: field - never a filename-prefix glob, the same
// false-collision guard task_scope_gate_lib.bb's own reader uses.
export function findTicketYamlContent(root: string, ticketId: string): string | undefined {
  const lanes = [path.join(root, 'backlog', 'active'), path.join(root, 'backlog', 'paused'), path.join(root, 'backlog', 'done')];
  for (const lane of lanes) {
    const found = findYamlInDir(lane, ticketId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// The one impure entry point: resolves the ticket's own acceptance: path
// from its landed YAML, then drives the fixed checklist through runFn.
// Never renders a verdict - the report is exactly checks + register_join
// (composeQaGatherReport, the pure core).
export function gatherQaChecklist(
  root: string,
  ticketId: string,
  opts: { task?: string; commit: string },
  runFn: RunFn = defaultRunFn
): QaGatherReport {
  const yamlContent = findTicketYamlContent(root, ticketId);
  return composeQaGatherReport(root, ticketId, opts, runFn, yamlContent);
}
