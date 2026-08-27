/**
 * BL-739: vacuous property generator check for /pilot land. Touched
 * *.property.test.js files that exercise splitTelegramChunks must generate
 * inputs long enough to cross the effective split boundary — otherwise refuse
 * land (BL-718 class: maxLength 200 vs TELEGRAM_MESSAGE_MAX_LENGTH 4096).
 */
import * as fs from 'fs';
import * as path from 'path';

export const PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL =
  'vacuous property generator cannot reach the function boundary';

export type VacuousPropertyMiss = {
  propertyFile: string;
  targetFunction: string;
  generatorBound: number;
  functionBoundary: number;
};

export type PropertyGeneratorReachCheckOutcome =
  | {
      checked: true;
      propertyFilesScanned: number;
      miss?: VacuousPropertyMiss;
      scannedPaths: string[];
    }
  | { checked: false };

const PROPERTY_TEST_RE = /\.property\.test\.js$/;
const FC_STRING_MAX_RE = /fc\.string\(\{[^}]*maxLength:\s*(\d+)/g;
const FC_STRING_MIN_RE = /fc\.string\(\{[^}]*minLength:\s*(\d+)/g;
const SPLIT_CALL_NUMERIC_RE = /splitTelegramChunks\([^,]+,\s*(\d+)\)/;
const SPLIT_CALL_CONST_RE = /splitTelegramChunks\([^,]+,\s*([A-Z][A-Z0-9_]*)\)/;
const CHUNKING_PROBE_CONST = 'CHUNKING_PROPERTY_MAX_LEN';
const TELEGRAM_MAX_CONST = 'TELEGRAM_MESSAGE_MAX_LENGTH';
const CORE_REL = 'extension/src/tools/telegramCursorBridgeCore.ts';
const CHUNKING_PROBE_REL = 'extension/test/helpers/chunkingPropertyProbe.js';

export function isPropertyTestPath(relativePath: string): boolean {
  return PROPERTY_TEST_RE.test(relativePath.replace(/\\/g, '/'));
}

function readRepoText(repoRoot: string, rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(repoRoot, rel.replace(/\\/g, '/')), 'utf8');
  } catch {
    return undefined;
  }
}

function maxCaptured(re: RegExp, text: string): number | undefined {
  let best: number | undefined;
  let match: RegExpExecArray | null;
  const copy = new RegExp(re.source, re.flags);
  while ((match = copy.exec(text)) !== null) {
    const n = Number(match[1]);
    if (!Number.isFinite(n)) {
      continue;
    }
    best = best === undefined ? n : Math.max(best, n);
  }
  return best;
}

function namedConstValue(text: string | undefined, name: string): number | undefined {
  if (!text) {
    return undefined;
  }
  const match = text.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : undefined;
}

function telegramDefaultBoundary(repoRoot: string): number | undefined {
  const core = readRepoText(repoRoot, CORE_REL);
  return namedConstValue(core, TELEGRAM_MAX_CONST);
}

function chunkingProbeText(repoRoot: string): string | undefined {
  return readRepoText(repoRoot, CHUNKING_PROBE_REL);
}

function chunkingProbeBoundary(repoRoot: string): number | undefined {
  return namedConstValue(chunkingProbeText(repoRoot), CHUNKING_PROBE_CONST);
}

function fcStringBounds(text: string): { maxLen?: number; minLen?: number } {
  return {
    maxLen: maxCaptured(FC_STRING_MAX_RE, text),
    minLen: maxCaptured(FC_STRING_MIN_RE, text),
  };
}

function generatorBoundsForProperty(repoRoot: string, propertyText: string): { maxLen?: number; minLen?: number } {
  const local = fcStringBounds(propertyText);
  if (propertyText.includes('runChunkingProperty')) {
    const probe = chunkingProbeText(repoRoot);
    const probeBounds = fcStringBounds(probe ?? '');
    return {
      maxLen: probeBounds.maxLen ?? local.maxLen,
      minLen: probeBounds.minLen ?? local.minLen,
    };
  }
  return local;
}

function resolveSplitBoundary(repoRoot: string, propertyText: string): number | undefined {
  if (propertyText.includes('runChunkingProperty')) {
    return chunkingProbeBoundary(repoRoot);
  }
  const numeric = propertyText.match(SPLIT_CALL_NUMERIC_RE);
  if (numeric) {
    return Number(numeric[1]);
  }
  const constRef = propertyText.match(SPLIT_CALL_CONST_RE);
  if (constRef) {
    return namedConstValue(propertyText, constRef[1]) ?? chunkingProbeBoundary(repoRoot);
  }
  return telegramDefaultBoundary(repoRoot);
}

function generatorCanReachBoundary(maxLen: number | undefined, minLen: number | undefined, boundary: number): boolean {
  if (minLen !== undefined && minLen > boundary) {
    return true;
  }
  if (maxLen === undefined) {
    return false;
  }
  return maxLen > boundary;
}

function assessSplitTelegramProperty(
  repoRoot: string,
  propertyFile: string,
  text: string
): VacuousPropertyMiss | undefined {
  if (!text.includes('splitTelegramChunks') && !text.includes('runChunkingProperty')) {
    return undefined;
  }
  const boundary = resolveSplitBoundary(repoRoot, text);
  if (boundary === undefined) {
    return undefined;
  }
  const { maxLen: generatorMax, minLen: generatorMin } = generatorBoundsForProperty(repoRoot, text);
  if (generatorCanReachBoundary(generatorMax, generatorMin, boundary)) {
    return undefined;
  }
  const generatorBound = generatorMax ?? generatorMin ?? 0;
  return {
    propertyFile,
    targetFunction: 'splitTelegramChunks',
    generatorBound,
    functionBoundary: boundary,
  };
}

function assessOnePropertyFile(
  repoRoot: string,
  propertyFile: string
): VacuousPropertyMiss | undefined {
  const text = readRepoText(repoRoot, propertyFile);
  if (!text) {
    return undefined;
  }
  return assessSplitTelegramProperty(repoRoot, propertyFile, text);
}

/** Scan touched property tests; refuse when generator bounds cannot cross split boundary. */
export function assessPropertyGeneratorReach(
  repoRoot: string,
  touchedRelativePaths: string[]
): PropertyGeneratorReachCheckOutcome {
  const scannedPaths: string[] = [];
  for (const rel of touchedRelativePaths) {
    const normalized = rel.replace(/\\/g, '/');
    if (!isPropertyTestPath(normalized)) {
      continue;
    }
    scannedPaths.push(normalized);
    const miss = assessOnePropertyFile(repoRoot, normalized);
    if (miss) {
      return { checked: true, propertyFilesScanned: scannedPaths.length, miss, scannedPaths };
    }
  }
  return { checked: true, propertyFilesScanned: scannedPaths.length, scannedPaths };
}
