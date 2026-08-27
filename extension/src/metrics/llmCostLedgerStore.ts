// BL-551: the fs-touching read side of the LLM cost ledger. Every writer is
// a Babashka script (handoffd.bb's deliver!, operator_runtime.bb's reap,
// agent_runtime_inject.bb's wake) appending to
// `.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl` - none of them can import
// compiled TS, so this module only ever reads. Kept apart from the pure
// llmCostLedger.ts ranking/rollup module for the same reason
// telegram-bridge-cost-line.ts splits its fs read from telegramBridgeCost.ts.
import * as fs from 'fs';
import * as path from 'path';
import {
  LlmInvocationOrigin,
  LlmInvocationRecord,
} from './llmCostLedger';

export function llmCostTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

const LEDGER_FILE_NAME_PATTERN = /^llm-cost-\d{4}-\d{2}\.jsonl$/;

function isLedgerFileName(name: string): boolean {
  return LEDGER_FILE_NAME_PATTERN.test(name);
}

// A correlation record (writer-handoff-02) has not resolved model/provider
// yet - both are honest-null there, so the guard only requires the field to
// be PRESENT (string or null), never non-null.
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const ORIGIN_STRING_OR_NULL_FIELDS: Array<keyof LlmInvocationOrigin> = [
  'role', 'stage', 'ticketId', 'handoffId', 'script', 'pack', 'model', 'provider',
];

function isValidOrigin(value: unknown): value is LlmInvocationOrigin {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<LlmInvocationOrigin>;
  if (typeof candidate.subsystem !== 'string' || typeof candidate.trigger !== 'string') {
    return false;
  }
  if (!('handoffType' in candidate)) {
    return false;
  }
  return ORIGIN_STRING_OR_NULL_FIELDS.every((field) => isNullableString(candidate[field]));
}

// hardener note: the `!value || typeof value !== 'object'` guard is the same
// mutation-equivalent shape isBridgeCostRecord documents in
// telegram-bridge-cost-line.ts - the sole caller (parseLlmInvocationLine)
// wraps the whole check in a try/catch, so removing the guard only changes
// WHERE a non-object line throws, not the end result (line skipped).
function isLlmInvocationRecord(value: unknown): value is LlmInvocationRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<LlmInvocationRecord>;
  return (
    candidate.type === 'llm_invocation'
    && typeof candidate.at === 'string'
    && (candidate.model === null || typeof candidate.model === 'string')
    && (candidate.costUsd === null || typeof candidate.costUsd === 'number')
    && isValidOrigin(candidate.origin)
  );
}

function parseLlmInvocationLine(line: string): LlmInvocationRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isLlmInvocationRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readLedgerFile(filePath: string): LlmInvocationRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const records: LlmInvocationRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const record = parseLlmInvocationLine(line);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

// Reads every monthly ledger file present (a 7-day horizon can span a month
// boundary), forgivingly - a missing telemetry dir, an unreadable file, or a
// malformed line all degrade to "skip", never a thrown error.
export function readLlmInvocationRecords(mainWorktreePath: string): LlmInvocationRecord[] {
  const dir = llmCostTelemetryDir(mainWorktreePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const records: LlmInvocationRecord[] = [];
  for (const name of names.filter(isLedgerFileName).sort()) {
    records.push(...readLedgerFile(path.join(dir, name)));
  }
  return records;
}
