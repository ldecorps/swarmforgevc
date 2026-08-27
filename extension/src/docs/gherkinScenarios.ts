// BL-117: extracts individual Gherkin scenarios as readable text from an
// already-resolved Gherkin source string. Works identically whether that
// source came from a specs/features/*.feature file or an inline
// acceptance: | block in ticket YAML - both are the same syntax by the
// time this pure function sees them (docs-drilldown-03's "both forms").

export interface GherkinScenario {
  id?: string;
  name: string;
  text: string;
  // BL-118 bilingual-04: text itself always stays canonical English (the
  // binding acceptance contract); textFr is an additive courtesy rendering
  // populated only by docsTree.ts's translateDocsTree, never by
  // extractScenarios itself.
  textFr?: string;
  textFrUntranslated?: boolean;
}

const SCENARIO_LINE = /^\s*(Scenario(?: Outline)?):\s*(.*)$/;

// BL-111's stable-index convention: a `# <TICKET-ID> <slug> [description...]`
// comment directly precedes each Scenario: line (e.g. `# BL-096 metrics-01`
// or `# BL-150 recert-01 oldest-first-selection`) - the first two
// whitespace-separated tokens after `#` are always the ticket id and the
// short stable slug; anything after that is optional descriptive text.
const TAG_LINE = /^\s*#\s*(\S+)\s+(\S+)/;

interface ScenarioBlock {
  id?: string;
  name: string;
  lines: string[];
}

// Groups lines into one block per Scenario:/Scenario Outline: line, each
// continuing until the next such line (or end of input). Lines before the
// first scenario line are dropped (feature-level prose, not scenario
// text). Each new block is already in the returned array from the moment
// it starts, so there is no separate "flush the last one" step - split out
// of extractScenarios so each function stays under the CRAP<=6 gate.
//
// BL-150: also tracks the tag comment immediately preceding a Scenario:
// line as that scenario's stable id (recertification needs an id that
// survives scenario reordering/insertion, unlike a positional index). Any
// non-blank line that isn't itself a tag comment clears the pending tag, so
// only a comment DIRECTLY above a Scenario: line is ever attributed to it -
// a trailing comment block after the last scenario, or a comment before an
// invalid/malformed line, is never mistaken for the next scenario's id.
function groupIntoScenarioBlocks(lines: string[]): ScenarioBlock[] {
  const blocks: ScenarioBlock[] = [];
  let pendingTagId: string | undefined;
  for (const line of lines) {
    const match = line.match(SCENARIO_LINE);
    if (match) {
      blocks.push({ id: pendingTagId, name: match[2].trim(), lines: [line.trim()] });
      pendingTagId = undefined;
      continue;
    }
    const tagMatch = line.match(TAG_LINE);
    if (tagMatch) {
      pendingTagId = `${tagMatch[1]}/${tagMatch[2]}`;
    } else if (line.trim() !== '') {
      pendingTagId = undefined;
    }
    if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
}

const COMMENT_LINE = /^\s*#/;

// QA bounce (2026-07-09): groupIntoScenarioBlocks unconditionally appends
// every non-Scenario line to whichever block is currently open, with
// nothing to stop collecting until the next Scenario:/Scenario Outline:
// line or end of input - so a `# BL-XXX tag-NN` comment that precedes the
// NEXT scenario ends up appended to the END of the CURRENT one, and the
// feature file's trailing "# Non-behavioral gates:" block ends up appended
// to the LAST scenario. Strips trailing blank/comment-only lines back to
// the block's own last real content line (never below the Scenario: line
// itself) before joining, so a scenario's text always ends at its own last
// step - this generalizes the pre-existing trailing-whitespace .trim(),
// which alone doesn't touch comment lines.
function stripTrailingCommentLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 1 && (COMMENT_LINE.test(lines[end - 1]) || lines[end - 1].trim() === '')) {
    end--;
  }
  return lines.slice(0, end);
}

function toScenario(block: ScenarioBlock): GherkinScenario {
  const scenario: GherkinScenario = { name: block.name, text: stripTrailingCommentLines(block.lines).join('\n').trim() };
  if (block.id !== undefined) {
    scenario.id = block.id;
  }
  return scenario;
}

export function extractScenarios(gherkinText: string | null | undefined): GherkinScenario[] {
  if (!gherkinText) {
    return [];
  }
  return groupIntoScenarioBlocks(gherkinText.split('\n')).map(toScenario);
}
