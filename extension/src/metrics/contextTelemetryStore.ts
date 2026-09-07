import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ContextTelemetryRecord } from './contextTelemetryProducer';

/**
 * BL-1477: the host's unclean shutdown on 2026-08-30 left the store's final
 * line as ~4 KB of NUL bytes with no trailing newline, and this reader threw
 * on it unconditionally - eight days of silence. NUL bytes are stripped from
 * every line before parsing (a record glued onto a zero-filled tail still
 * parses), and a torn FINAL line (still unparseable after stripping, with no
 * whole line after it) is dropped and named rather than treated as damage -
 * the same tail-vs-interior distinction turnProfileProducer.ts's
 * assessTranscriptReadability already draws for transcripts (BL-1364).
 * Interior damage - an unparseable line with a whole line after it - throws,
 * naming the 1-based line number: the store is the dedupe cursor, and
 * recording against a cursor that cannot be read would duplicate.
 */
export function stripNulBytes(text: string): string {
  return text.replace(/\u0000/g, '');
}

export interface PersistedContextEventsRead {
  events: ContextTelemetryRecord[];
  /** 1-based line number of a dropped torn final line, or null when none. */
  tornTailLine: number | null;
}

export function readPersistedContextEvents(telemetryDir: string): PersistedContextEventsRead {
  const filePath = path.join(telemetryDir, 'context-events.jsonl');
  if (!fs.existsSync(filePath)) {
    return { events: [], tornTailLine: null };
  }
  const rawLines = fs.readFileSync(filePath, 'utf8').split('\n');
  const numbered: Array<{ line: string; lineNumber: number }> = [];
  rawLines.forEach((raw, index) => {
    // A genuinely blank line (empty, or whitespace only) in the RAW text is
    // skipped silently - the ordinary gap between records. Blankness is
    // checked on the RAW line, never the NUL-stripped one: a line of
    // nothing but NUL bytes has real (damaged) content and must surface as
    // a torn tail, not vanish as if it were an empty line that was never
    // written at all.
    if (!raw.trim()) {
      return;
    }
    numbered.push({ line: stripNulBytes(raw), lineNumber: index + 1 });
  });
  const parsed: Array<{ ok: true; event: ContextTelemetryRecord } | { ok: false; lineNumber: number }> =
    numbered.map(({ line, lineNumber }) => {
      try {
        return { ok: true, event: JSON.parse(line) as ContextTelemetryRecord };
      } catch {
        return { ok: false, lineNumber };
      }
    });
  const badIndexes = parsed.reduce<number[]>((acc, entry, index) => {
    if (!entry.ok) {
      acc.push(index);
    }
    return acc;
  }, []);
  if (badIndexes.length === 0) {
    return {
      events: parsed.map((entry) => (entry as { ok: true; event: ContextTelemetryRecord }).event),
      tornTailLine: null,
    };
  }
  if (badIndexes.length === 1 && badIndexes[0] === parsed.length - 1) {
    const tornTailLine = numbered[badIndexes[0]].lineNumber;
    return {
      events: parsed
        .slice(0, -1)
        .map((entry) => (entry as { ok: true; event: ContextTelemetryRecord }).event),
      tornTailLine,
    };
  }
  const firstBadLine = numbered[badIndexes[0]].lineNumber;
  throw new Error(`context-events store: unparseable line ${firstBadLine}`);
}

/**
 * BL-1477: the default (no injected recordFn) production path. Recording
 * used to spawn one `bb context_telemetry_cli.bb record` per event with no
 * cap - ~200000 events backlogged behind the torn-tail defect is ~0.3s of
 * subprocess start-up EACH, a day of subprocess time that would overrun the
 * 60s subprocess wait bound every cycle (BL-1454's shape). One `record-batch`
 * spawn per tick, reading JSONL from stdin, is what makes the per-tick cap
 * reachable inside its deadline.
 */
export function recordEventsViaCliBatch(
  repoRoot: string,
  telemetryDir: string,
  events: ContextTelemetryRecord[]
): void {
  if (events.length === 0) {
    return;
  }
  const cli = path.join(repoRoot, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');
  const input = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  execFileSync('bb', [cli, 'record-batch'], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDir },
  });
}
