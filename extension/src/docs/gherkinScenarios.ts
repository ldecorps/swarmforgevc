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

export function extractScenarios(gherkinText: string | null | undefined): GherkinScenario[] {
  if (!gherkinText) {
    return [];
  }

  const scenarios: GherkinScenario[] = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of gherkinText.split('\n')) {
    const match = line.match(SCENARIO_LINE);
    if (match) {
      if (current) {
        scenarios.push({ name: current.name, text: current.lines.join('\n').trim() });
      }
      current = { name: match[2].trim(), lines: [line.trim()] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    scenarios.push({ name: current.name, text: current.lines.join('\n').trim() });
  }

  return scenarios;
}
