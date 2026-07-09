'use strict';

function substitute(text, exampleRow) {
  if (!exampleRow) {
    return text;
  }
  return text.replace(/<([A-Za-z0-9_]+)>/g, (whole, name) => (name in exampleRow ? exampleRow[name] : whole));
}

function scenarioSteps(feature, scenario) {
  return [...(feature.background || []), ...scenario.steps];
}

async function runScenario(registry, feature, scenario, exampleRow) {
  const context = {};
  for (const step of scenarioSteps(feature, scenario)) {
    const text = substitute(step.text, exampleRow);
    const resolved = registry.resolve(text);
    if (!resolved) {
      throw new Error(`Scenario "${scenario.name}": no step handler matched "${step.keyword} ${text}"`);
    }
    try {
      await resolved.handler(context, ...resolved.args);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Scenario "${scenario.name}" failed at step "${step.keyword} ${text}": ${reason}`);
    }
  }
}

module.exports = { runScenario, substitute, scenarioSteps };
