'use strict';

// BL-259: a Scenario Outline Examples column name may legitimately contain
// spaces (e.g. "forbidden edge", "what is checked") - matches ANY
// non-angle-bracket text between < and >, not just [A-Za-z0-9_]+, so a
// multi-word placeholder is substituted the same as a single-word one.
function substitute(text, exampleRow) {
  if (!exampleRow) {
    return text;
  }
  return text.replace(/<([^<>]+)>/g, (whole, name) => (name in exampleRow ? exampleRow[name] : whole));
}

function scenarioSteps(feature, scenario) {
  return [...(feature.background || []), ...scenario.steps];
}

// BL-1357: dispose whatever the scenario registered, exactly once, on every
// exit path. A disposal failure never masks the failure that triggered it -
// if the scenario already threw, the original error is what propagates, with
// the disposal failure reported alongside rather than instead. If the scenario
// completed normally and disposal throws, that error propagates.
//
// The disposal mechanism records what was disposed in context.__disposed so
// that assertion steps can verify disposal happened, even though disposal
// itself runs in the finally block after all steps complete.
async function dispose(context, scenarioError) {
  const disposables = context.__disposables;
  if (!Array.isArray(disposables) || disposables.length === 0) {
    return scenarioError;
  }
  // Mark disposed so a second call (e.g. from a nested finally) is a no-op.
  context.__disposables = [];
  context.__disposed = [];
  let disposalError = null;
  for (const disposeFn of disposables) {
    try {
      await disposeFn();
      context.__disposed.push('disposed');
    } catch (err) {
      context.__disposed.push('failed');
      if (!disposalError) {
        disposalError = err;
      }
    }
  }
  if (scenarioError) {
    // Original failure takes precedence; disposal failure is reported alongside
    // if present, but never replaces the original.
    if (disposalError) {
      scenarioError.message += ` (disposal also failed: ${disposalError.message})`;
    }
    return scenarioError;
  }
  return disposalError;
}

async function runScenario(registry, feature, scenario, exampleRow) {
  const context = {};
  let scenarioError = null;
  try {
    for (const step of scenarioSteps(feature, scenario)) {
      const text = substitute(step.text, exampleRow);
      const resolved = registry.resolve(text, feature.name);
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
  } catch (err) {
    scenarioError = err;
  }
  const finalError = await dispose(context, scenarioError);
  if (finalError) {
    throw finalError;
  }
}

module.exports = { runScenario, substitute, scenarioSteps };
