// BL-1732: the shared, seeded vocabulary behind the Intake form's three
// narrative dropdowns (actor/action/goal). Durable JSON, host-side file -
// never browser storage (Architecture rule 3). A value added mid-draft is
// NOT written here yet (invariant: "A value joins the shared vocabulary
// only as part of a submitted intake that uses it") - the draft carries
// its own pending additions (withDraftValue below), and only Submit calls
// promoteVocabulary to fold them in.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export type NarrativeSlot = 'actor' | 'action' | 'goal';

export interface Vocabulary {
  actor: string[];
  action: string[];
  goal: string[];
}

const VOCAB_RELATIVE_PATH = ['backlog', 'vocabulary', 'intake-narrative.yaml'];

export function vocabularyPath(targetPath: string): string {
  return path.join(targetPath, ...VOCAB_RELATIVE_PATH);
}

export function vocabularyRelativePath(): string {
  return path.join(...VOCAB_RELATIVE_PATH);
}

// The starter list (ticket's own words, stored without the template
// words - the parenthetical glossary is hint text, never part of the
// value).
export const STARTER_VOCABULARY: Vocabulary = {
  actor: [
    'the human',
    'a phone user',
    'a SwarmForge VC user',
    'the operator',
    'the specifier',
    'the coder',
    'the cleaner',
    'the architect',
    'the hardender',
    'the documenter',
    'QA',
    'the coordinator',
    'the art director',
  ],
  action: [
    'file a new intake from my phone',
    'see that an agent has accepted my question',
    'chat with a local model about the project',
    'run a swarm seat on a local model',
    'approve or reject a pending decision',
  ],
  goal: [
    'know the swarm is working on it',
    'keep the backlog in one ubiquitous language',
    'work on the project away from my desk',
    'cut cloud token costs',
    'trust that nothing lands without review',
  ],
};

function emptyVocabulary(): Vocabulary {
  return { actor: [], action: [], goal: [] };
}

// BL-1732 property-lane find: a value carrying a bare backslash or an
// embedded newline broke the round-trip below - a backslash escaped only
// the closing quote's own `\"` sequence (never itself), and a real
// newline split one logical entry across two physical lines the
// line-by-line parser below can never rejoin. Escaping the backslash
// FIRST (so a later literal `"`/`n`/`r` is never misread as part of an
// earlier escape) and encoding newlines/carriage returns as the two-
// character `\n`/`\r` sequences keeps every entry on its own physical
// line, which the line-based parser requires.
function escapeVocabValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function unescapeVocabValue(escaped: string): string {
  let out = '';
  for (let i = 0; i < escaped.length; i++) {
    const ch = escaped[i];
    if (ch === '\\' && i + 1 < escaped.length) {
      const next = escaped[i + 1];
      if (next === 'n') {
        out += '\n';
      } else if (next === 'r') {
        out += '\r';
      } else {
        out += next;
      }
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

// Hand-rolled scalar-list YAML (mirrors the swarmforge/scripts ledger
// idiom: `actor:\n  - value\n`), never a YAML library dependency on the
// TS side either.
export function renderVocabulary(vocab: Vocabulary): string {
  const slots: NarrativeSlot[] = ['actor', 'action', 'goal'];
  return slots
    .map((slot) => `${slot}:\n${vocab[slot].map((v) => `  - "${escapeVocabValue(v)}"`).join('\n')}\n`)
    .join('\n');
}

export function parseVocabulary(text: string): Vocabulary {
  const vocab = emptyVocabulary();
  let current: NarrativeSlot | null = null;
  for (const rawLine of text.split('\n')) {
    const slotMatch = rawLine.match(/^(actor|action|goal):\s*$/);
    if (slotMatch) {
      current = slotMatch[1] as NarrativeSlot;
      continue;
    }
    const itemMatch = rawLine.match(/^\s*-\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (itemMatch && current) {
      vocab[current].push(unescapeVocabValue(itemMatch[1]));
    }
  }
  return vocab;
}

export function readVocabulary(targetPath: string): Vocabulary {
  try {
    return parseVocabulary(fs.readFileSync(vocabularyPath(targetPath), 'utf8'));
  } catch {
    return emptyVocabulary();
  }
}

export function seedVocabularyIfMissing(targetPath: string): void {
  const p = vocabularyPath(targetPath);
  if (fs.existsSync(p)) {
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWrite(p, renderVocabulary(STARTER_VOCABULARY));
}

// Pure: a vocabulary with `value` appended to `slot`, unless already
// present (never a duplicate entry, in the shared list or a draft's own
// pending set).
export function withValue(vocab: Vocabulary, slot: NarrativeSlot, value: string): Vocabulary {
  const trimmed = value.trim();
  if (!trimmed || vocab[slot].includes(trimmed)) {
    return vocab;
  }
  return { ...vocab, [slot]: [...vocab[slot], trimmed] };
}

// Folds every value in `additions` into the shared vocabulary and writes
// it - called ONLY at Submit, with the draft's own new values (invariant
// 1: a value joins the shared vocabulary only as part of a submitted
// intake that uses it).
export function promoteVocabulary(targetPath: string, additions: Partial<Record<NarrativeSlot, string>>): Vocabulary {
  let vocab = readVocabulary(targetPath);
  (Object.keys(additions) as NarrativeSlot[]).forEach((slot) => {
    const value = additions[slot];
    if (value) {
      vocab = withValue(vocab, slot, value);
    }
  });
  fs.mkdirSync(path.dirname(vocabularyPath(targetPath)), { recursive: true });
  atomicWrite(vocabularyPath(targetPath), renderVocabulary(vocab));
  return vocab;
}
