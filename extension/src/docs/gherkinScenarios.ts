// BL-117: extracts individual Gherkin scenarios as readable text from an
// already-resolved Gherkin source string. Works identically whether that
// source came from a specs/features/*.feature file or an inline
// acceptance: | block in ticket YAML - both are the same syntax by the
// time this pure function sees them (docs-drilldown-03's "both forms").

export interface GherkinScenario {
  name: string;
  text: string;
}

const SCENARIO_LINE = /^\s*(Scenario(?: Outline)?):\s*(.*)$/;

interface ScenarioBlock {
  name: string;
  lines: string[];
}

// Groups lines into one block per Scenario:/Scenario Outline: line, each
// continuing until the next such line (or end of input). Lines before the
// first scenario line are dropped (feature-level prose, not scenario
// text). Each new block is already in the returned array from the moment
// it starts, so there is no separate "flush the last one" step - split out
// of extractScenarios so each function stays under the CRAP<=6 gate.
function groupIntoScenarioBlocks(lines: string[]): ScenarioBlock[] {
  const blocks: ScenarioBlock[] = [];
  for (const line of lines) {
    const match = line.match(SCENARIO_LINE);
    if (match) {
      blocks.push({ name: match[2].trim(), lines: [line.trim()] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
}

function toScenario(block: ScenarioBlock): GherkinScenario {
  return { name: block.name, text: block.lines.join('\n').trim() };
}

export function extractScenarios(gherkinText: string | null | undefined): GherkinScenario[] {
  if (!gherkinText) {
    return [];
  }
  return groupIntoScenarioBlocks(gherkinText.split('\n')).map(toScenario);
}
